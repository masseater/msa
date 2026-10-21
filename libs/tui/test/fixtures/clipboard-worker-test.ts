import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

import { Cause, Console, Effect } from "effect";

import testPlatform from "../test-platform.ts";

const { readFileBytes } = testPlatform;

interface WorkerTestHelper {
  getText(): Promise<string | undefined>;
  getImage(): Promise<Buffer | undefined>;
  state(): string;
  release(): void;
}

const require = createRequire(import.meta.url);
const selfPath = fileURLToPath(import.meta.url);
// oxlint-disable-next-line msa/no-builtin-require
const loadHelper = (addon: string): WorkerTestHelper => require(addon);

const waitFor = (
  predicate: () => boolean,
  deadline: number = performance.now() + 5000,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (predicate()) return;
    assert.ok(performance.now() < deadline, "Timed out waiting for the private reader");
    yield* Effect.sleep(10);
    yield* waitFor(predicate, deadline);
  });

const workerThread = Effect.gen(function* () {
  const helper = loadHelper(String(workerData));
  void helper.getText();
  yield* waitFor(() => helper.state().startsWith("1,"));
  parentPort?.postMessage("reading");
});

const workerExit = (addon: string): Effect.Effect<void> =>
  Effect.gen(function* () {
    const worker = new Worker(selfPath, { workerData: addon });
    yield* Effect.promise(() => once(worker, "message"));
    yield* Effect.promise(() => worker.terminate());
    const helper = loadHelper(addon);
    assert.equal(helper.state(), "1,1,1", "The detached operation survives environment teardown");
    helper.release();
    yield* waitFor(() => helper.state() === "1,0,0");
    assert.equal(yield* Effect.promise(() => helper.getText()), "text");
    yield* Console.log("passed");
  });

const concurrentReads = (helper: WorkerTestHelper): Effect.Effect<void> =>
  Effect.gen(function* () {
    const concurrentStarted = performance.now();
    const concurrent = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 1 ? helper.getText() : helper.getImage(),
    );
    yield* readFileBytes(selfPath);
    assert.deepEqual(
      yield* Effect.promise(() => Promise.all(concurrent)),
      Array.from({ length: 20 }, () => undefined),
    );
    assert.ok(
      performance.now() - concurrentStarted < 1500,
      "Concurrent reads and filesystem I/O must remain available",
    );
  });

const sharedReader = (addon: string, mode: string | undefined): Effect.Effect<void> =>
  Effect.gen(function* () {
    const helper = loadHelper(addon);
    const started = performance.now();
    const pending = helper.getText();
    yield* waitFor(() => helper.state().startsWith("1,"));
    if (mode === "process-exit") {
      assert.equal(yield* Effect.promise(() => pending), undefined);
      yield* Console.log("passed");
      return;
    }
    yield* concurrentReads(helper);
    assert.equal(yield* Effect.promise(() => pending), undefined);
    assert.ok(performance.now() - started < 4500, "The shared worker must leave its bounded wait");
    assert.equal(helper.state(), "1,1,1", "Only one private reader may remain blocked");
    assert.equal(yield* Effect.promise(() => helper.getImage()), undefined);
    assert.equal(helper.state(), "1,1,1", "Another request must not start another private reader");
    helper.release();
    yield* waitFor(() => helper.state() === "1,0,0");
    assert.equal(yield* Effect.promise(() => helper.getText()), "text");
    assert.deepEqual(yield* Effect.promise(() => helper.getImage()), Buffer.from("text"));
    assert.equal(helper.state(), "3,0,0", "Late and successful results must all be freed");
    yield* Console.log("passed");
  });

const program = Effect.suspend(() => {
  if (!isMainThread) return workerThread;
  const [addon = "", mode] = process.argv.slice(2);
  return mode === "worker-exit" ? workerExit(addon) : sharedReader(addon, mode);
}).pipe(
  Effect.catchCause((cause) =>
    Console.error(Cause.squash(cause)).pipe(
      Effect.andThen(
        Effect.sync(() => {
          process.exitCode = 1;
        }),
      ),
    ),
  ),
);

Effect.runFork(program);
