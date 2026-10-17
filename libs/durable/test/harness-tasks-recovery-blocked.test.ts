import { rm } from "node:fs/promises";

import { Type } from "@msa/ai";
import {
  createRegistry,
  defineDoc,
  defineTask,
  defineTool,
  MemoryStorage,
  type Registry,
} from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { addTask, addTool } from "./harness-support.ts";
import {
  startHandover,
  createIn,
  handoverTask,
  sqlitePath,
  directories,
  type Step,
  versioned,
} from "./harness-tasks-recovery-support.ts";
import { context, flush } from "./session-support.ts";
import { aborted, completed, deferred, eventually, openTasks } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

async function failedMigrationTask() {
  const path = await sqlitePath();
  const opened = await openTasks(await openNodeSqliteStorage(path), []);
  const id = await createIn(opened.harness, versioned(1, "v1"));
  await opened.harness.close(context);

  const registry: Registry = createRegistry();
  const counted: { failures: number } = { failures: 0 };
  addTask(
    registry,
    versioned(2, "v2", () => {
      counted.failures++;
      throw new Error("cannot migrate");
    }),
  );
  const reopened = await openTasks(await openNodeSqliteStorage(path), [], { registry });
  reopened.harness.resume();
  await eventually(() => reopened.reports.length === 1);
  return { id, registry, counted, reopened };
}

describe("blocked tasks", () => {
  it("migrates at reservation, leaves the record unchanged when migration fails, and retries only for a new definition", async () => {
    const { id, registry, counted, reopened } = await failedMigrationTask();
    // An unrelated registry change wakes the scheduler without retrying the same failed definition.
    addTool(
      registry,
      defineTool({
        name: "unrelated",
        description: "unrelated",
        parameters: Type.Object({}),
        execute: () => Promise.resolve({}),
      }),
    );
    await flush();
    expect(counted.failures).toBe(1);
    expect(reopened.reports).toHaveLength(1);
    expect(String(reopened.reports[0])).toContain("cannot migrate");
    expect(await reopened.harness.getTask(id, context)).toMatchObject({
      version: 1,
      state: { status: "pending", checkpoint: { phase: "run" } },
    });

    const migrations: number[] = [];
    // The same extension name replaces the old one in place.
    addTask(
      registry,
      versioned(2, "v2", (_input, checkpoint, fromVersion) => {
        migrations.push(fromVersion);
        return { input: null, checkpoint: checkpoint as Step };
      }),
    );
    const receipt = await reopened.harness.waitForTask(id, context);
    expect(receipt).toMatchObject({
      version: 2,
      state: { outcome: { status: "completed", result: "v2" } },
    });
    expect(migrations).toEqual([1]);
    await reopened.harness.close(context);
  });
});

describe("blocked tasks", () => {
  it("blocks an older record whose newer definition has no migration", async () => {
    const path = await sqlitePath();
    let opened = await openTasks(await openNodeSqliteStorage(path), []);
    const id = await createIn(opened.harness, versioned(1, "v1"));
    await opened.harness.close(context);
    opened = await openTasks(await openNodeSqliteStorage(path), [versioned(2, "v2")]);
    opened.harness.resume();
    await eventually(() => opened.reports.length === 1);
    expect(String(opened.reports[0])).toContain("has no migration from 1");
    expect(await opened.harness.getTask(id, context)).toMatchObject({
      version: 1,
      state: { status: "pending" },
    });
    await opened.harness.close(context);
  });

  it("settles an aborted blocked task as orphaned and retires its documents", async () => {
    const Scratch = defineDoc<{ n: number }>({
      kind: "test.orphan-scratch",
      version: 1,
      scope: "task",
      initial: () => ({ n: 0 }),
    });
    const { harness } = await openTasks(new MemoryStorage(), []);
    const root = await harness.root(context);
    const id = await root.commit(async (tx) => {
      const created = await tx.createTask(versioned(1, "x"), null, {
        ownership: { kind: "conversation" },
      });
      (await tx.doc(Scratch, created)).n = 1;
      return created;
    }, context);
    // Before resume: the marking commit settles the blocked task directly.
    expect(await harness.abortTask(id, context)).toBe("marked");
    expect((await harness.getTask(id, context))?.state).toEqual({
      status: "terminal",
      outcome: { status: "orphaned", reason: "missing_task" },
    });
    expect(await harness.snapshot(Scratch, id, context)).toBeUndefined();
    await harness.close(context);
  });
});

describe("blocked tasks", () => {
  it("orphans a marked task whose definition disappeared while its run was active", async () => {
    const reached = deferred();
    const Running = defineTask<null, Step, null>({
      name: "test.vanishing",
      version: 1,
      initial: () => ({ phase: "run" }),
      phases: {
        run: async (_task, runtime) => {
          reached.resolve();
          await aborted(runtime.signal);
        },
      },
      abort: () => {
        return Promise.reject(new Error("must not run"));
      },
    });
    const registry = createRegistry();
    const registration = addTask(registry, Running);
    const { harness } = await openTasks(new MemoryStorage(), [], { registry });
    const id = await createIn(harness, Running);
    harness.resume();
    await reached.promise;
    registration.dispose();
    // An active run means the mark does not orphan directly; the scheduler orphans once the run has ended.
    expect(await harness.abortTask(id, context)).toBe("marked");
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "orphaned",
      reason: "missing_task",
    });
    await harness.close(context);
  });
});

describe("blocked tasks", () => {
  it("orphans a reopened abort-marked task without a definition once scheduling resumes", async () => {
    const path = await sqlitePath();
    let opened = await openTasks(await openNodeSqliteStorage(path), [versioned(1, "x")]);
    const id = await createIn(opened.harness, versioned(1, "x"));
    expect(await opened.harness.abortTask(id, context)).toBe("marked");
    await opened.harness.close(context);

    opened = await openTasks(await openNodeSqliteStorage(path), []);
    expect(await opened.harness.getTask(id, context)).toMatchObject({
      abortRequested: true,
      state: { status: "pending" },
    });
    const idle = opened.harness.waitForIdle(context);
    opened.harness.resume();
    await idle;
    expect((await opened.harness.getTask(id, context))?.state).toEqual({
      status: "terminal",
      outcome: { status: "orphaned", reason: "missing_task" },
    });
    await opened.harness.close(context);
  });
});

describe("definition handover", () => {
  it("hands over at the next phase boundary to a same-version replacement without overlap", async () => {
    const log: string[] = [];
    const gate = deferred();
    const { harness, registry, id } = await startHandover(log, { a: gate.promise });
    // The same extension name replaces the old one in place.
    addTask(registry, handoverTask("new", 1, log));
    gate.resolve();
    await harness.waitForTask(id, context);
    expect(log).toEqual(["old:a start", "old:a end", "new:b start", "new:b end", "new:c"]);
    await harness.close(context);
  });
});

describe("definition handover", () => {
  it("keeps the memos across a handover", async () => {
    type Memoed = { phase: "a" } | { phase: "b" };
    const log: string[] = [];
    const gate = deferred();
    const reached = deferred();
    const memoTask = (label: string) =>
      defineTask<null, Memoed, string>({
        name: "test.handover-memo",
        version: 1,
        initial: () => ({ phase: "a" }),
        phases: {
          a: async (_task, runtime, ctx) => {
            await runtime.memo("picked", label, ctx);
            reached.resolve();
            await gate.promise;
            await runtime.commit(() => ({ status: "running", checkpoint: { phase: "b" } }), ctx);
          },
          b: async (_task, runtime, ctx) => {
            // The candidate loses to the memo the old definition stored.
            const picked = await runtime.memo("picked", label, ctx);
            log.push(`${label}:b ${picked}`);
            await runtime.commit(() => completed(picked), ctx);
          },
        },
        abort: async () => {},
      });
    const registry = createRegistry();
    addTask(registry, memoTask("old"));
    const { harness } = await openTasks(new MemoryStorage(), [], { registry });
    const id = await createIn(harness, memoTask("old"));
    harness.resume();
    await reached.promise;
    addTask(registry, memoTask("new"));
    gate.resolve();
    const receipt = await harness.waitForTask(id, context);
    expect(receipt.state.outcome).toEqual({ status: "completed", result: "old" });
    expect(log).toEqual(["new:b old"]);
    await harness.close(context);
  });
});

describe("definition handover", () => {
  it("hands over to a newer version with a migration", async () => {
    const log: string[] = [];
    const gate = deferred();
    const { harness, registry, id } = await startHandover(log, { a: gate.promise });
    // The same extension name replaces the old one in place.
    addTask(
      registry,
      handoverTask("v2", 2, log, { migrate: () => ({ input: null, checkpoint: { phase: "c" } }) }),
    );
    gate.resolve();
    const receipt = await harness.waitForTask(id, context);
    expect(receipt.version).toBe(2);
    expect(log).toEqual(["old:a start", "old:a end", "v2:c"]);
    await harness.close(context);
  });

  it("hands over to a newer version whose migration fails and leaves the task blocked", async () => {
    const log: string[] = [];
    const gate = deferred();
    const { harness, registry, id, reports } = await startHandover(log, { a: gate.promise });
    // The same extension name replaces the old one in place.
    addTask(
      registry,
      handoverTask("broken", 2, log, {
        migrate: () => {
          throw new Error("broken migration");
        },
      }),
    );
    gate.resolve();
    await eventually(() => reports.length === 1);
    await flush();
    expect(await harness.getTask(id, context)).toMatchObject({
      version: 1,
      state: { status: "pending", checkpoint: { phase: "b" } },
    });
    expect(log).toEqual(["old:a start", "old:a end"]);
    await harness.close(context);
  });
});
