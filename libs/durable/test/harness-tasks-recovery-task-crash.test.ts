import { defineTask } from "@msa/durable";
import { createRegistry } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createIn, directories, type Step, versioned } from "./harness-tasks-recovery-support.ts";
import {
  awaited,
  addTask,
  removeDir,
  ControlledStorage,
  context,
  flush,
  abortMarked,
  abortedWith,
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

type Log = string[];

function crashTask(log: Log, options: { blockAbort: boolean }) {
  return defineTask<null, Step, null>({
    name: "test.crash",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: () =>
        Effect.runPromise(
          Effect.gen(function* () {
            log.push("run");
            return yield* Effect.never;
          }),
        ),
    },
    abort: (_task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          log.push("abort");
          if (options.blockAbort) return yield* Effect.never;
          yield* awaited(runtime.commit(() => abortedWith("recovered"), ctx));
        }),
      ),
  });
}

const recover = Effect.fn("recover")(function* (storage: ControlledStorage, log: Log) {
  storage.crash();
  const { harness } = yield* openTasks(storage, [crashTask(log, { blockAbort: false })]);
  const page = yield* awaited(
    harness.commit((tx) => tx.scanTasks({ kind: "test.crash" }, 1), context),
  );
  return { harness, id: page.items[0]!.id };
});

const crashedRun = Effect.fn("crashedRun")(function* (log: Log) {
  const storage = new ControlledStorage();
  const { harness } = yield* openTasks(storage, [crashTask(log, { blockAbort: true })]);
  const id = yield* createIn(harness, crashTask(log, { blockAbort: true }));
  harness.resume();
  yield* eventually(() => log.length === 1);
  return { storage, harness, id };
});

const crashMarkCommit = Effect.gen(function* () {
  const log: Log = [];
  const { storage, harness, id } = yield* crashedRun(log);
  const held = storage.holdCommits();
  void harness.abortTask(id, context);
  yield* awaited(held.entered);
  const recovered = yield* recover(storage, log);
  expect(yield* awaited(recovered.harness.getTask(id, context))).toMatchObject({
    abortRequested: false,
    state: { status: "pending" },
  });
  recovered.harness.resume();
  yield* eventually(() => log.length === 2);
  expect(log).toEqual(["run", "run"]);
});

const crashMarkRun = Effect.gen(function* () {
  const log: Log = [];
  const { storage, harness, id } = yield* crashedRun(log);
  let joined = false;
  void harness.abortTask(id, context).then(() => {
    joined = true;
    return undefined;
  });
  yield* abortMarked(harness, id);
  yield* flush;
  expect(joined).toBe(false);
  const recovered = yield* recover(storage, log);
  expect(yield* awaited(recovered.harness.getTask(id, context))).toMatchObject({
    abortRequested: true,
    state: { status: "pending" },
  });
  recovered.harness.resume();
  expect((yield* awaited(recovered.harness.waitForTask(id, context))).state.outcome).toEqual({
    status: "aborted",
    reason: "recovered",
  });
  expect(log).toEqual(["run", "abort"]);
  yield* awaited(recovered.harness.close(context));
});

describe("task crash recovery", () => {
  it("crash while the mark commit is in storage: the run resumes", () =>
    Effect.runPromise(crashMarkCommit));

  it("crash after the mark before the run joins: only the abort handler runs", () =>
    Effect.runPromise(crashMarkRun));
});

const crashAbortHandler = Effect.gen(function* () {
  const log: Log = [];
  const storage = new ControlledStorage();
  const Crash = crashTask(log, { blockAbort: true });
  const { harness } = yield* openTasks(storage, [Crash]);
  const id = yield* createIn(harness, Crash);
  yield* awaited(harness.abortTask(id, context));
  harness.resume();
  yield* eventually(() => log.length === 1);
  expect(log).toEqual(["abort"]);
  expect(yield* awaited(harness.getTask(id, context))).toMatchObject({
    state: { status: "running" },
  });
  const recovered = yield* recover(storage, log);
  recovered.harness.resume();
  expect((yield* awaited(recovered.harness.waitForTask(id, context))).state.outcome).toEqual({
    status: "aborted",
    reason: "recovered",
  });
  expect(log).toEqual(["abort", "abort"]);
  yield* awaited(recovered.harness.close(context));
});

describe("task crash recovery", () => {
  it("crash while the abort handler runs: a fresh abort invocation settles the task", () =>
    Effect.runPromise(crashAbortHandler));
});

const crashAbortOutcome = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const log: Log = [];
  const storage = new ControlledStorage();
  const reached = deferred();
  const proceed = deferred();
  const Crash = defineTask<null, Step, null>({
    name: "test.crash",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: { run: () => Promise.resolve() },
    abort: (_task, runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          log.push("abort");
          reached.resolve();
          yield* awaited(proceed.promise);
          yield* awaited(runtime.commit(() => abortedWith("lost"), ctx));
        }),
      ),
  });
  const { harness } = yield* openTasks(storage, [Crash]);
  const id = yield* createIn(harness, Crash);
  yield* awaited(harness.abortTask(id, context));
  harness.resume();
  yield* awaited(reached.promise);
  const held = storage.holdCommits();
  proceed.resolve();
  yield* awaited(held.entered);
  const recovered = yield* recover(storage, log);
  recovered.harness.resume();
  expect((yield* awaited(recovered.harness.waitForTask(id, context))).state.outcome).toEqual({
    status: "aborted",
    reason: "recovered",
  });
  expect(log).toEqual(["abort", "abort"]);
  yield* awaited(recovered.harness.close(context));
});

describe("task crash recovery", () => {
  it("crash while the abort outcome is in storage: the abort handler runs again", () =>
    Effect.runPromise(crashAbortOutcome));
});

const crashTerminalOutcome = Effect.gen(function* () {
  const log: Log = [];
  const storage = new ControlledStorage();
  const Crash = crashTask(log, { blockAbort: false });
  const { harness } = yield* openTasks(storage, [Crash]);
  const id = yield* createIn(harness, Crash);
  yield* awaited(harness.abortTask(id, context));
  harness.resume();
  yield* awaited(harness.waitForTask(id, context));
  const recovered = yield* recover(storage, log);
  recovered.harness.resume();
  yield* flush;
  expect(log).toEqual(["abort"]);
  expect((yield* awaited(recovered.harness.getTask(id, context)))?.state).toEqual({
    status: "terminal",
    outcome: { status: "aborted", reason: "recovered" },
  });
  yield* awaited(recovered.harness.close(context));
});

const crashReservationCommit = Effect.gen(function* () {
  const log: Log = [];
  const storage = new ControlledStorage();
  const Crash = crashTask(log, { blockAbort: false });
  const { harness } = yield* openTasks(storage, [Crash]);
  const id = yield* createIn(harness, Crash);
  const held = storage.holdCommits();
  harness.resume();
  yield* awaited(held.entered);
  const recovered = yield* recover(storage, log);
  expect((yield* awaited(recovered.harness.getTask(id, context)))?.state.status).toBe("pending");
  expect(log).toEqual([]);
  yield* awaited(recovered.harness.abortTask(id, context));
  recovered.harness.resume();
  yield* awaited(recovered.harness.waitForTask(id, context));
  expect(log).toEqual(["abort"]);
  yield* awaited(recovered.harness.close(context));
});

describe("task crash recovery", () => {
  it("crash after the terminal outcome: nothing runs again", () =>
    Effect.runPromise(crashTerminalOutcome));

  it("crash while the reservation commit is in storage: the task is still pending", () =>
    Effect.runPromise(crashReservationCommit));
});

const keepsTaskMissing = Effect.gen(function* () {
  const V1 = versioned(1, "v1");
  const { harness, registry } = yield* openTasks(new MemoryStorage(), []);
  const id = yield* createIn(harness, V1);
  harness.resume();
  yield* flush;
  expect((yield* awaited(harness.getTask(id, context)))?.state.status).toBe("pending");
  const idle = harness.waitForIdle(context);
  yield* flush;
  addTask(registry, V1);
  yield* awaited(idle);
  expect((yield* awaited(harness.getTask(id, context)))?.state).toEqual({
    status: "terminal",
    outcome: { status: "completed", result: "v1" },
  });
  yield* awaited(harness.close(context));
});

const keepsTaskStored = Effect.gen(function* () {
  const registry = createRegistry();
  addTask(registry, versioned(1, "old"));
  const { harness } = yield* openTasks(new MemoryStorage(), [], { registry });
  const id = yield* createIn(harness, versioned(2, "new"));
  harness.resume();
  yield* flush;
  expect((yield* awaited(harness.getTask(id, context)))?.state.status).toBe("pending");
  addTask(registry, versioned(2, "new"));
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    status: "completed",
    result: "new",
  });
  yield* awaited(harness.close(context));
});

describe("blocked tasks", () => {
  it("keeps a task with a missing definition pending, and live for idle waits, until registration", () =>
    Effect.runPromise(keepsTaskMissing));

  it("keeps a task stored by a newer version pending until a fitting definition is registered", () =>
    Effect.runPromise(keepsTaskStored));
});
