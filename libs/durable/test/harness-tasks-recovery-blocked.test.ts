import { Type } from "@msa/ai";
import { defineDoc, defineTask, defineTool, type Registry } from "@msa/durable";
import { createRegistry } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import {
  startHandover,
  createIn,
  handoverTask,
  sqlitePath,
  directories,
  type Step,
  versioned,
} from "./harness-tasks-recovery-support.ts";
import {
  awaited,
  addTask,
  addTool,
  removeDir,
  context,
  flush,
  aborted,
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

const failedMigrationTask = Effect.fn("failedMigrationTask")(function* () {
  const path = yield* sqlitePath();
  const opened = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), []);
  const id = yield* createIn(opened.harness, versioned(1, "v1"));
  yield* awaited(opened.harness.close(context));

  const registry: Registry = createRegistry();
  const counted: { failures: number } = { failures: 0 };
  addTask(
    registry,
    versioned(2, "v2", () => {
      counted.failures++;
      throw new Error("cannot migrate");
    }),
  );
  const reopened = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [], { registry });
  reopened.harness.resume();
  yield* eventually(() => reopened.reports.length === 1);
  return { id, registry, counted, reopened };
});

const migratesReservationLeaves = Effect.gen(function* () {
  const { id, registry, counted, reopened } = yield* failedMigrationTask();
  addTool(
    registry,
    defineTool({
      name: "unrelated",
      description: "unrelated",
      parameters: Type.Object({}),
      execute: () => Promise.resolve({}),
    }),
  );
  yield* flush;
  expect(counted.failures).toBe(1);
  expect(reopened.reports).toHaveLength(1);
  expect(String(reopened.reports[0])).toContain("cannot migrate");
  expect(yield* awaited(reopened.harness.getTask(id, context))).toMatchObject({
    version: 1,
    state: { status: "pending", checkpoint: { phase: "run" } },
  });

  const migrations: number[] = [];
  addTask(
    registry,
    versioned(2, "v2", (_input, checkpoint, fromVersion) => {
      migrations.push(fromVersion);
      return { input: null, checkpoint: checkpoint as Step };
    }),
  );
  const receipt = yield* awaited(reopened.harness.waitForTask(id, context));
  expect(receipt).toMatchObject({
    version: 2,
    state: { outcome: { status: "completed", result: "v2" } },
  });
  expect(migrations).toEqual([1]);
  yield* awaited(reopened.harness.close(context));
});

describe("blocked tasks", () => {
  it("migrates at reservation, leaves the record unchanged when migration fails, and retries only for a new definition", () =>
    Effect.runPromise(migratesReservationLeaves));
});

const blocksOlderRecord = Effect.gen(function* () {
  const path = yield* sqlitePath();
  let opened = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), []);
  const id = yield* createIn(opened.harness, versioned(1, "v1"));
  yield* awaited(opened.harness.close(context));
  opened = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [versioned(2, "v2")]);
  opened.harness.resume();
  yield* eventually(() => opened.reports.length === 1);
  expect(String(opened.reports[0])).toContain("has no migration from 1");
  expect(yield* awaited(opened.harness.getTask(id, context))).toMatchObject({
    version: 1,
    state: { status: "pending" },
  });
  yield* awaited(opened.harness.close(context));
});

const settlesAbortedBlocked = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Scratch = defineDoc<{ n: number }>({
    kind: "test.orphan-scratch",
    version: 1,
    scope: "task",
    initial: () => ({ n: 0 }),
  });
  const { harness } = yield* openTasks(new MemoryStorage(), []);
  const root = yield* awaited(harness.root(context));
  const id = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const created = yield* awaited(
              tx.createTask(versioned(1, "x"), null, {
                ownership: { kind: "conversation" },
              }),
            );
            (yield* awaited(tx.doc(Scratch, created))).n = 1;
            return created;
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(harness.abortTask(id, context))).toBe("marked");
  expect((yield* awaited(harness.getTask(id, context)))?.state).toEqual({
    status: "terminal",
    outcome: { status: "orphaned", reason: "missing_task" },
  });
  expect(yield* awaited(harness.snapshot(Scratch, id, context))).toBeUndefined();
  yield* awaited(harness.close(context));
});

describe("blocked tasks", () => {
  it("blocks an older record whose newer definition has no migration", () =>
    Effect.runPromise(blocksOlderRecord));

  it("settles an aborted blocked task as orphaned and retires its documents", () =>
    Effect.runPromise(settlesAbortedBlocked));
});

const orphansMarkedTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const reached = deferred();
  const Running = defineTask<null, Step, null>({
    name: "test.vanishing",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: (_task, runtime) =>
        runPromise(
          Effect.gen(function* () {
            reached.resolve();
            return yield* awaited(aborted(runtime.signal));
          }),
        ),
    },
    abort: () => Promise.reject(new Error("must not run")),
  });
  const registry = createRegistry();
  const registration = addTask(registry, Running);
  const { harness } = yield* openTasks(new MemoryStorage(), [], { registry });
  const id = yield* createIn(harness, Running);
  harness.resume();
  yield* awaited(reached.promise);
  registration.dispose();
  expect(yield* awaited(harness.abortTask(id, context))).toBe("marked");
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    status: "orphaned",
    reason: "missing_task",
  });
  yield* awaited(harness.close(context));
});

describe("blocked tasks", () => {
  it("orphans a marked task whose definition disappeared while its run was active", () =>
    Effect.runPromise(orphansMarkedTask));
});

const orphansReopenedAbort = Effect.gen(function* () {
  const path = yield* sqlitePath();
  let opened = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), [versioned(1, "x")]);
  const id = yield* createIn(opened.harness, versioned(1, "x"));
  expect(yield* awaited(opened.harness.abortTask(id, context))).toBe("marked");
  yield* awaited(opened.harness.close(context));

  opened = yield* openTasks(yield* awaited(openNodeSqliteStorage(path)), []);
  expect(yield* awaited(opened.harness.getTask(id, context))).toMatchObject({
    abortRequested: true,
    state: { status: "pending" },
  });
  const idle = opened.harness.waitForIdle(context);
  opened.harness.resume();
  yield* awaited(idle);
  expect((yield* awaited(opened.harness.getTask(id, context)))?.state).toEqual({
    status: "terminal",
    outcome: { status: "orphaned", reason: "missing_task" },
  });
  yield* awaited(opened.harness.close(context));
});

describe("blocked tasks", () => {
  it("orphans a reopened abort-marked task without a definition once scheduling resumes", () =>
    Effect.runPromise(orphansReopenedAbort));
});

const handsOverNext = Effect.gen(function* () {
  const log: string[] = [];
  const gate = deferred();
  const { harness, registry, id } = yield* startHandover(log, { a: gate.promise });
  addTask(registry, handoverTask("new", 1, log));
  gate.resolve();
  yield* awaited(harness.waitForTask(id, context));
  expect(log).toEqual(["old:a start", "old:a end", "new:b start", "new:b end", "new:c"]);
  yield* awaited(harness.close(context));
});

describe("definition handover", () => {
  it("hands over at the next phase boundary to a same-version replacement without overlap", () =>
    Effect.runPromise(handsOverNext));
});
