import { runInNewContext } from "node:vm";

import { createModels } from "@msa/ai";
import { defineExtension, defineTask, LiveDoc } from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  contained,
  running,
  safeNow,
  started,
  Waiting,
} from "./harness-storage-failure-support.ts";
import { awaited, context, openTasks } from "./support.ts";

const containsFulfilledThenable = Effect.gen(function* () {
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => unhandled.push(error);
  process.on("uncaughtException", onUnhandled);
  process.on("unhandledRejection", onUnhandled);
  yield* Effect.gen(function* () {
    const errors: unknown[] = [];
    const thenable = { then: (resolve: () => void) => queueMicrotask(() => resolve()) };
    contained(
      () => thenable,
      (error) => errors.push(error),
    );
    yield* Effect.sleep(10);
    expect(errors).toEqual([]);
    expect(unhandled).toEqual([]);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        process.off("uncaughtException", onUnhandled);
        process.off("unhandledRejection", onUnhandled);
      }),
    ),
  );
});

const containsRejectedPromise = Effect.gen(function* () {
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);
  yield* Effect.gen(function* () {
    const foreign = runInNewContext("Promise.reject(new Error('foreign'))") as Promise<never>;
    const errors: unknown[] = [];
    contained(
      () => foreign,
      (error) => errors.push(error),
    );
    yield* Effect.sleep(10);
    expect(errors.map(String)).toEqual(["Error: foreign"]);
    expect(unhandled).toEqual([]);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        process.off("unhandledRejection", onUnhandled);
      }),
    ),
  );
});

describe("listener and report errors", () => {
  it("contains a fulfilled thenable that calls only its fulfillment handler", () =>
    Effect.runPromise(containsFulfilledThenable));

  it("contains a rejected promise from another realm", () =>
    Effect.runPromise(containsRejectedPromise));
});

const reportsThrowingWatch = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { harness, root, reports } = yield* started(new MemoryStorage());
  const watch = (yield* awaited(harness.watchDoc(LiveDoc, root.id, context)))!;
  const failure = new Error("listener broke");
  watch.start(() => Promise.reject(failure));
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, root.id))).compactions = [];
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(watch.closed)).toEqual({ reason: "listener_error", error: failure });
  expect(reports).toEqual([failure]);
  yield* awaited(harness.close(context));
});

describe("listener and report errors", () => {
  it("reports a throwing watch listener, which ends that watch", () =>
    Effect.runPromise(reportsThrowingWatch));
});

const faultsOnlyTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const unformattable = Object.create(null) as object;
  const Throws = defineTask<null, { phase: "work" }, null>({
    name: "test.throws-unformattable",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: () => Promise.reject(unformattable),
    },
    abort: () => Promise.resolve(),
  });
  const opened = yield* openTasks(new MemoryStorage(), [Throws]);
  const root = yield* awaited(opened.harness.root(context));
  const watch = (yield* awaited(opened.harness.watchDoc(LiveDoc, root.id, context)))!;
  watch.start(() => Promise.reject(unformattable));
  const id = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Throws, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  opened.harness.resume();
  expect((yield* awaited(opened.harness.waitForTask(id, context))).state.outcome).toEqual({
    status: "faulted",
    error: { message: "[object Object]" },
  });
  yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(LiveDoc, root.id))).compactions = [];
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(watch.closed)).toMatchObject({ reason: "listener_error" });
  yield* awaited(
    expect(
      root.commit((tx) => tx.appendEntry(root.id, { kind: "note" }), context),
    ).resolves.toBeDefined(),
  );
  yield* awaited(opened.harness.close(context));
});

describe("listener and report errors", () => {
  it("faults only the task, and ends only the watch, for a thrown value that cannot be formatted", () =>
    Effect.runPromise(faultsOnlyTask));
});

const keepsWorkingOnReport = Effect.gen(function* () {
  const registry = createRegistry();
  registry.install(defineExtension({ name: "tasks", tasks: [Waiting] }));
  const harness = yield* awaited(
    Harness.open(
      new MemoryStorage(),
      {
        models: createModels(),
        registry,
        now: () => {
          throw new Error("clock broke");
        },
        onReport: () => {
          throw new Error("report broke");
        },
      },
      context,
    ),
  );
  const root = yield* awaited(harness.root(context));
  const id = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Waiting, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  harness.resume();
  yield* running(harness, id);
  expect((yield* awaited(harness.getTask(id, context)))?.startedAt).toEqual(expect.any(Number));
  yield* awaited(harness.abortTask(id, context));
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome.status).toBe("aborted");
  yield* awaited(harness.close(context));
});

describe("listener and report errors", () => {
  it("reports a throwing clock once, also when the report handler reads the clock again", () => {
    const reports: unknown[] = [];
    const clock = safeNow(
      () => {
        throw new Error("clock broke");
      },
      (error) => {
        reports.push(error);
        if (reports.length < 5) clock();
      },
    );
    expect(clock()).toEqual(expect.any(Number));
    clock();
    expect(reports.map(String)).toEqual(["Error: clock broke"]);
  });

  it("keeps working when onReport throws, and falls back to Date.now when the clock throws", () =>
    Effect.runPromise(keepsWorkingOnReport));
});
