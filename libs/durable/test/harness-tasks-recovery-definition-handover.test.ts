import { createModels } from "@msa/ai";
import { defineTask, type TaskId, type TaskRuntime } from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  startHandover,
  createIn,
  type OpenHarness,
  handoverTask,
  type Handover,
  type Gates,
  directories,
  type Step,
} from "./harness-tasks-recovery-support.ts";
import {
  awaited,
  addTask,
  removeDir,
  ControlledStorage,
  context,
  flush,
  completed,
  countingReader,
  deferred,
  eventually,
  openTasks,
} from "./support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const directory of directories) yield* removeDir(directory);
      directories.clear();
    }),
  ),
);

const keepsRunningUnder = Effect.gen(function* () {
  const log: string[] = [];
  const gateA = deferred();
  const gateB = deferred();
  const { harness, registry, old, id, reports } = yield* startHandover(log, {
    a: gateA.promise,
    b: gateB.promise,
  });
  old.dispose();
  gateA.resolve();
  yield* eventually(() => log.includes("old:b start"));
  addTask(registry, handoverTask("incompatible", 2, log));
  gateB.resolve();
  yield* awaited(harness.waitForTask(id, context));
  expect(log).toEqual(["old:a start", "old:a end", "old:b start", "old:b end", "old:c"]);
  expect(reports.map((report) => (report as Error).cause)).toEqual([
    "missing_task",
    "incompatible_task",
  ]);
  yield* awaited(harness.close(context));
});

describe("definition handover", () => {
  it("keeps running under the old definition when the replacement is missing or cannot take the task", () =>
    Effect.runPromise(keepsRunningUnder));
});

const rejectsRuntimeCommit = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const log: string[] = [];
  const gate = deferred();
  const storage = new ControlledStorage();
  let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
  let oldRuntime: TaskRuntime<null, Handover, null, object> | undefined;
  let harnessRef: OpenHarness | undefined;
  const registry = createRegistry();
  const Old = defineTask<null, Handover, null>({
    name: "test.handover",
    version: 1,
    initial: () => ({ phase: "a" }),
    phases: {
      a: (task, runtime, ctx) =>
        runPromise(
          Effect.gen(function* () {
            const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            oldRuntime = runtime;
            yield* awaited(gate.promise);
            yield* awaited(
              runtime.commit(() => ({ status: "running", checkpoint: { phase: "b" } }), ctx),
            );
            held = storage.holdCommits();
            void harnessRef!.commit(
              (tx) =>
                runPromise(
                  Effect.asVoid(
                    Effect.suspend(() =>
                      awaited(tx.appendEntry(task.conversationId, { kind: "blocker" })),
                    ),
                  ),
                ),
              ctx,
            );
          }),
        ),
      b: () => Promise.resolve(),
      c: () => Promise.resolve(),
    },
    abort: () => Promise.resolve(),
  });
  addTask(registry, Old);
  const { harness } = yield* openTasks(storage, [], { registry });
  harnessRef = harness;
  const id = yield* createIn(harness, Old);
  harness.resume();
  yield* eventually(() => oldRuntime !== undefined);
  addTask(registry, handoverTask("new", 1, log));
  gate.resolve();
  yield* eventually(() => held !== undefined);
  yield* awaited(held!.entered);
  yield* flush;
  const late = oldRuntime!.commit(() => completed(null), context);
  held!.release();
  yield* awaited(expect(late).rejects.toThrow("invocation has ended"));
  yield* awaited(harness.waitForTask(id, context));
  expect(log).toEqual(["new:b start", "new:b end", "new:c"]);
  yield* awaited(harness.close(context));
});

describe("definition handover", () => {
  it("rejects a runtime commit of the old invocation queued behind its handover commit", () =>
    Effect.runPromise(rejectsRuntimeCommit));
});

const preservesAbortMark = Effect.gen(function* () {
  const log: string[] = [];
  const gate = deferred();
  const storage = new ControlledStorage();
  let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
  const gates: Gates = {
    a: gate.promise,
    onEnd: () => {
      held ??= storage.holdCommits();
    },
  };
  const { harness, registry, id } = yield* startHandover(log, gates, storage);
  addTask(registry, handoverTask("new", 1, log));
  gate.resolve();
  yield* eventually(() => held !== undefined);
  yield* awaited(held!.entered);
  const aborting = harness.abortTask(id, context);
  held!.release();
  expect(yield* awaited(aborting)).toBe("marked");
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    status: "aborted",
    reason: "new",
  });
  const states = storage.commits.flatMap((writes) =>
    writes.flatMap((write) =>
      write.type === "task" && write.value.id === id
        ? [`${write.value.state.status}${write.value.abortRequested ? "+mark" : ""}`]
        : [],
    ),
  );
  expect(states).toEqual([
    "pending",
    "running",
    "running",
    "pending",
    "pending+mark",
    "running+mark",
    "terminal+mark",
  ]);
  expect(log).toEqual(["old:a start", "old:a end", "new:abort"]);
  yield* awaited(harness.close(context));
});

describe("definition handover", () => {
  it("preserves an abort mark that races the handover commit; the new definition aborts", () =>
    Effect.runPromise(preservesAbortMark));
});

const releasesRegistrySubscription = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  const log: string[] = [];
  const Stuck = defineTask<null, Step, null>({
    name: "test.stuck",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: () =>
        runPromise(
          Effect.gen(function* () {
            log.push("run");
            return yield* Effect.never;
          }),
        ),
    },
    abort: () => Promise.resolve(),
  });
  const first = yield* openTasks(storage, [Stuck]);
  yield* createIn(first.harness, Stuck);
  first.harness.resume();
  yield* eventually(() => log.length === 1);

  const registry = createRegistry();
  const reader = countingReader(registry);
  storage.failNextCommit(new Error("disk full"));
  yield* awaited(
    expect(
      Harness.open(storage, { models: createModels(), registry: reader }, context),
    ).rejects.toThrow("disk full"),
  );
  expect(reader.subscriptions()).toBe(0);
  yield* awaited(expect(storage.task(1 as TaskId, context)).rejects.toThrow());
});

describe("Harness open", () => {
  it("releases its registry subscription and closes the Session when open fails", () =>
    Effect.runPromise(releasesRegistrySubscription));
});
