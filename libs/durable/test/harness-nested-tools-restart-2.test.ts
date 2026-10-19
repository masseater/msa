import { defineExtension, defineTask } from "@msa/durable";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  spawnThroughBatch,
  directories,
  sqlitePath,
  open,
} from "./harness-nested-tools-restart-support.ts";
import {
  chatSetup,
  awaited,
  removeDir,
  context,
  aborted,
  deferred,
  eventually,
} from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const lateWorkerSetup = Effect.fn("lateWorkerSetup")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const aborts: (string | undefined)[] = [];
  const started = deferred();
  const Worker = defineTask<null, { phase: "work" }, null>({
    name: "test.late",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: (_task, runtime) =>
        runPromise(
          Effect.gen(function* () {
            started.resolve();
            return yield* awaited(aborted(runtime.signal));
          }),
        ),
    },
    abort: (task, runtime, abortContext) =>
      runPromise(
        Effect.gen(function* () {
          aborts.push(task.abortReason);
          yield* awaited(
            runtime.commit(
              () => ({ status: "terminal", outcome: { status: "aborted" } }),
              abortContext,
            ),
          );
        }),
      ),
  });
  const extension = defineExtension({ name: "late", tasks: [Worker] });
  setup.registry.install(extension);
  return { path, setup, aborts, started, Worker, extension };
});

const keepsAbandonedTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { path, setup, aborts, started, Worker, extension } = yield* lateWorkerSetup();
  const spawned = spawnThroughBatch(setup, Worker);
  let opened = yield* open(path, setup);
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(started.promise);
  yield* awaited(opened.harness.close(context));

  setup.registry.uninstall(extension);
  opened = yield* open(path, setup);
  opened.harness.resume();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        const inspected = (yield* awaited(opened.harness.inspect(context))).tasks.find(
          (task) => task.record.id === spawned.worker,
        );
        return inspected?.state.kind === "blocked";
      }),
    ),
  );
  expect((yield* awaited(opened.harness.getTask(spawned.worker!, context)))?.state.status).not.toBe(
    "terminal",
  );
  expect(aborts).toEqual([]);
  setup.registry.install(extension);
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("done");
  expect(aborts).toEqual(["restart"]);
  expect((yield* awaited(opened.harness.getTask(spawned.worker!, context)))?.state).toMatchObject({
    status: "terminal",
    outcome: { status: "aborted" },
  });
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("keeps an abandoned task whose definition is missing waiting until it is installed, then runs its abort", () =>
    Effect.runPromise(keepsAbandonedTask));
});

const orphansAbandonedTaskStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const path = yield* sqlitePath();
  const setup = chatSetup();
  const started = deferred();
  const Worker = defineTask<null, { phase: "work" }, null>({
    name: "test.gone",
    version: 1,
    initial: () => ({ phase: "work" }),
    phases: {
      work: (_task, runtime) =>
        runPromise(
          Effect.gen(function* () {
            started.resolve();
            return yield* awaited(aborted(runtime.signal));
          }),
        ),
    },
    abort: (_task, runtime, abortContext) =>
      runPromise(
        Effect.asVoid(
          Effect.suspend(() =>
            awaited(
              runtime.commit(
                () => ({ status: "terminal", outcome: { status: "aborted" } }),
                abortContext,
              ),
            ),
          ),
        ),
      ),
  });
  const extension = defineExtension({ name: "gone", tasks: [Worker] });
  setup.registry.install(extension);
  const spawned = spawnThroughBatch(setup, Worker);
  return { runPromise, path, setup, started, extension, spawned };
});

const orphansAbandonedTask = Effect.gen(function* () {
  const { runPromise, path, setup, started, extension, spawned } = yield* orphansAbandonedTaskStep1;
  let opened = yield* open(path, setup);
  const id = (yield* awaited(opened.root.submit({ type: "input", content: "go" }, context))).id;
  yield* awaited(started.promise);
  yield* awaited(opened.harness.close(context));

  setup.registry.uninstall(extension);
  opened = yield* open(path, setup);
  opened.harness.resume();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        const record = yield* awaited(opened.harness.getTask(spawned.worker!, context));
        return record?.abortReason === "restart";
      }),
    ),
  );
  yield* awaited(opened.root.abort(context));
  expect((yield* awaited(opened.harness.getTask(spawned.worker!, context)))?.state).toMatchObject({
    status: "terminal",
    outcome: { status: "orphaned", reason: "missing_task" },
  });
  expect(
    (yield* awaited((yield* awaited(opened.harness.submission(id, context)))!.wait(context)))
      .status,
  ).toBe("unanswered");
  yield* awaited(opened.harness.close(context));
});

describe("nested tool calls across a restart", () => {
  it("orphans an abandoned task whose definition is missing once an abort is requested", () =>
    Effect.runPromise(orphansAbandonedTask));
});
