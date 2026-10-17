import { rm } from "node:fs/promises";

import { createRegistry, defineTask, MemoryStorage, type TaskId } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { addTask } from "./harness-support.ts";
import {
  createIn,
  type OpenHarness,
  directories,
  type Step,
  versioned,
} from "./harness-tasks-recovery-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { abortMarked, abortedWith, deferred, eventually, openTasks } from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

type Log = string[];

// A task whose run ignores its signal and whose abort handler blocks while `blockAbort` is set.
function crashTask(log: Log, options: { blockAbort: boolean }) {
  return defineTask<null, Step, null>({
    name: "test.crash",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async () => {
        log.push("run");
        await new Promise(() => {});
      },
    },
    abort: async (_task, runtime, ctx) => {
      log.push("abort");
      if (options.blockAbort) await new Promise(() => {});
      await runtime.commit(() => abortedWith("recovered"), ctx);
    },
  });
}

async function recover(
  storage: ControlledStorage,
  log: Log,
): Promise<{ harness: OpenHarness; id: TaskId }> {
  storage.crash();
  const { harness } = await openTasks(storage, [crashTask(log, { blockAbort: false })]);
  const page = await harness.commit((tx) => tx.scanTasks({ kind: "test.crash" }, 1), context);
  return { harness, id: page.items[0]!.id };
}

async function crashedRun(
  log: Log,
): Promise<{ storage: ControlledStorage; harness: OpenHarness; id: TaskId }> {
  const storage = new ControlledStorage();
  const { harness } = await openTasks(storage, [crashTask(log, { blockAbort: true })]);
  const id = await createIn(harness, crashTask(log, { blockAbort: true }));
  harness.resume();
  await eventually(() => log.length === 1);
  return { storage, harness, id };
}

/**
 * Crash simulation: the crashed Harness is abandoned without close, its held storage commit never lands, and its
 * blocked handlers never return. A new Harness then opens the same storage.
 */
describe("task crash recovery", () => {
  it("crash while the mark commit is in storage: the run resumes", async () => {
    const log: Log = [];
    const { storage, harness, id } = await crashedRun(log);
    const held = storage.holdCommits();
    void harness.abortTask(id, context);
    await held.entered;
    const recovered = await recover(storage, log);
    expect(await recovered.harness.getTask(id, context)).toMatchObject({
      abortRequested: false,
      state: { status: "pending" },
    });
    recovered.harness.resume();
    await eventually(() => log.length === 2);
    expect(log).toEqual(["run", "run"]);
  });

  it("crash after the mark before the run joins: only the abort handler runs", async () => {
    const log: Log = [];
    const { storage, harness, id } = await crashedRun(log);
    // The run ignores its signal, so abortTask never finishes joining it.
    let joined = false;
    void harness.abortTask(id, context).then(() => {
      joined = true;
    });
    await abortMarked(harness, id);
    await flush();
    expect(joined).toBe(false);
    const recovered = await recover(storage, log);
    expect(await recovered.harness.getTask(id, context)).toMatchObject({
      abortRequested: true,
      state: { status: "pending" },
    });
    recovered.harness.resume();
    expect((await recovered.harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "recovered",
    });
    expect(log).toEqual(["run", "abort"]);
    await recovered.harness.close(context);
  });
});

/**
 * Crash simulation: the crashed Harness is abandoned without close, its held storage commit never lands, and its
 * blocked handlers never return. A new Harness then opens the same storage.
 */
describe("task crash recovery", () => {
  it("crash while the abort handler runs: a fresh abort invocation settles the task", async () => {
    const log: Log = [];
    const storage = new ControlledStorage();
    const Crash = crashTask(log, { blockAbort: true });
    const { harness } = await openTasks(storage, [Crash]);
    const id = await createIn(harness, Crash);
    await harness.abortTask(id, context);
    harness.resume();
    await eventually(() => log.length === 1);
    expect(log).toEqual(["abort"]);
    expect(await harness.getTask(id, context)).toMatchObject({ state: { status: "running" } });
    const recovered = await recover(storage, log);
    recovered.harness.resume();
    expect((await recovered.harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "recovered",
    });
    expect(log).toEqual(["abort", "abort"]);
    await recovered.harness.close(context);
  });
});

/**
 * Crash simulation: the crashed Harness is abandoned without close, its held storage commit never lands, and its
 * blocked handlers never return. A new Harness then opens the same storage.
 */
describe("task crash recovery", () => {
  it("crash while the abort outcome is in storage: the abort handler runs again", async () => {
    const log: Log = [];
    const storage = new ControlledStorage();
    const reached = deferred();
    const proceed = deferred();
    const Crash = defineTask<null, Step, null>({
      name: "test.crash",
      version: 1,
      initial: () => ({ phase: "run" }),
      phases: { run: async () => {} },
      abort: async (_task, runtime, ctx) => {
        log.push("abort");
        reached.resolve();
        await proceed.promise;
        await runtime.commit(() => abortedWith("lost"), ctx);
      },
    });
    const { harness } = await openTasks(storage, [Crash]);
    const id = await createIn(harness, Crash);
    await harness.abortTask(id, context);
    harness.resume();
    await reached.promise;
    const held = storage.holdCommits();
    proceed.resolve();
    await held.entered;
    const recovered = await recover(storage, log);
    recovered.harness.resume();
    expect((await recovered.harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "recovered",
    });
    expect(log).toEqual(["abort", "abort"]);
    await recovered.harness.close(context);
  });
});

/**
 * Crash simulation: the crashed Harness is abandoned without close, its held storage commit never lands, and its
 * blocked handlers never return. A new Harness then opens the same storage.
 */
describe("task crash recovery", () => {
  it("crash after the terminal outcome: nothing runs again", async () => {
    const log: Log = [];
    const storage = new ControlledStorage();
    const Crash = crashTask(log, { blockAbort: false });
    const { harness } = await openTasks(storage, [Crash]);
    const id = await createIn(harness, Crash);
    await harness.abortTask(id, context);
    harness.resume();
    await harness.waitForTask(id, context);
    const recovered = await recover(storage, log);
    recovered.harness.resume();
    await flush();
    expect(log).toEqual(["abort"]);
    expect((await recovered.harness.getTask(id, context))?.state).toEqual({
      status: "terminal",
      outcome: { status: "aborted", reason: "recovered" },
    });
    await recovered.harness.close(context);
  });

  it("crash while the reservation commit is in storage: the task is still pending", async () => {
    const log: Log = [];
    const storage = new ControlledStorage();
    const Crash = crashTask(log, { blockAbort: false });
    const { harness } = await openTasks(storage, [Crash]);
    const id = await createIn(harness, Crash);
    const held = storage.holdCommits();
    harness.resume();
    await held.entered;
    const recovered = await recover(storage, log);
    expect((await recovered.harness.getTask(id, context))?.state.status).toBe("pending");
    expect(log).toEqual([]);
    await recovered.harness.abortTask(id, context);
    recovered.harness.resume();
    await recovered.harness.waitForTask(id, context);
    expect(log).toEqual(["abort"]);
    await recovered.harness.close(context);
  });
});

describe("blocked tasks", () => {
  it("keeps a task with a missing definition pending, and live for idle waits, until registration", async () => {
    const V1 = versioned(1, "v1");
    const { harness, registry } = await openTasks(new MemoryStorage(), []);
    const id = await createIn(harness, V1);
    harness.resume();
    await flush();
    expect((await harness.getTask(id, context))?.state.status).toBe("pending");
    const idle = harness.waitForIdle(context);
    await flush();
    addTask(registry, V1);
    await idle;
    expect((await harness.getTask(id, context))?.state).toEqual({
      status: "terminal",
      outcome: { status: "completed", result: "v1" },
    });
    await harness.close(context);
  });

  it("keeps a task stored by a newer version pending until a fitting definition is registered", async () => {
    const registry = createRegistry();
    addTask(registry, versioned(1, "old"));
    const { harness } = await openTasks(new MemoryStorage(), [], { registry });
    const id = await createIn(harness, versioned(2, "new"));
    harness.resume();
    await flush();
    expect((await harness.getTask(id, context))?.state.status).toBe("pending");
    // The same extension name replaces the old one in place.
    addTask(registry, versioned(2, "new"));
    expect((await harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "completed",
      result: "new",
    });
    await harness.close(context);
  });
});
