import { rm } from "node:fs/promises";

import { defineTask } from "@msa/durable";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { createIn, sqlitePath, directories, type Step } from "./harness-tasks-recovery-support.ts";
import { context, flush } from "./session-support.ts";
import {
  abortMarked,
  aborted,
  abortedWith,
  completed,
  deferred,
  eventually,
  openTasks,
} from "./task-support.ts";

afterEach(async () => {
  for await (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.clear();
});

/** Fake external service whose operations are idempotent by request key. */
class TransferService {
  readonly applied = new Map<string, number>();
  calls = 0;

  apply(key: string, amount: number): Promise<number> {
    this.calls++;
    if (!this.applied.has(key)) this.applied.set(key, amount * 10);
    return Promise.resolve(this.applied.get(key)!);
  }
}

type TransferState = { phase: "prepare" } | { phase: "apply"; key: string };

// Intent/effect/outcome task: `prepare` commits the intent, `apply` performs the effect and commits the outcome.
// While `interrupt.first` is set, the first `apply` blocks after the effect until the invocation is signalled.
function transferTask(service: TransferService, interrupt: { first: boolean }) {
  return defineTask<{ amount: number }, TransferState, { receipt: number }>({
    name: "test.transfer",
    version: 1,
    initial: () => ({ phase: "prepare" }),
    phases: {
      prepare: async (task, runtime, ctx) => {
        await runtime.memo("requested", task.input.amount, ctx);
        await runtime.commit(
          () => ({ status: "running", checkpoint: { phase: "apply", key: `transfer-${task.id}` } }),
          ctx,
        );
      },
      apply: async (task, runtime, ctx) => {
        const receipt = await service.apply(task.state.checkpoint.key, task.input.amount);
        if (interrupt.first) {
          interrupt.first = false;
          await aborted(runtime.signal);
        }
        await runtime.commit(() => completed({ receipt }), ctx);
      },
    },
    abort: async (_task, runtime, ctx) => {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
    },
  });
}

async function abortMarkedAtClose() {
  const path = await sqlitePath();
  const log: string[] = [];
  const abortGate = { block: true };
  const abortReached = deferred();
  const runRelease = deferred();
  const Abortable = defineTask<null, Step, null>({
    name: "test.abortable",
    version: 1,
    initial: () => ({ phase: "run" }),
    phases: {
      run: async () => {
        log.push("run");
        // Ignores the abort signal until released, so the mark is durable while the run is active.
        await runRelease.promise;
      },
    },
    abort: async (_task, runtime, ctx) => {
      log.push("abort");
      if (abortGate.block) {
        abortReached.resolve();
        await aborted(runtime.signal);
      }
      await runtime.commit(() => abortedWith("stop"), ctx);
    },
  });

  // Stage 1: the mark is committed while the run invocation is still active.
  const opened = await openTasks(await openNodeSqliteStorage(path), [Abortable]);
  const id = await createIn(opened.harness, Abortable);
  opened.harness.resume();
  await eventually(() => log.length === 1);
  const aborting = opened.harness.abortTask(id, context);
  await abortMarked(opened.harness, id);
  const closing = opened.harness.close(context);
  runRelease.resolve();
  await closing;
  expect(await aborting).toBe("marked");
  expect(log).toEqual(["run"]);
  return { path, log, abortGate, abortReached, Abortable, id };
}

describe("task recovery", () => {
  it("resumes an intent/effect/outcome task interrupted after its intent across close and reopen", async () => {
    const path = await sqlitePath();
    const service = new TransferService();
    const Transfer = transferTask(service, { first: true });

    const first = await openTasks(await openNodeSqliteStorage(path), [Transfer]);
    const root = await first.harness.root(context);
    const id = await root.commit(
      (tx) => tx.createTask(Transfer, { amount: 7 }, { ownership: { kind: "conversation" } }),
      context,
    );
    first.harness.resume();
    await eventually(() => service.calls === 1);
    await first.harness.close(context);

    const second = await openTasks(await openNodeSqliteStorage(path), [Transfer]);
    // Open reconciled `running` to `pending` and kept the checkpoint and memos; nothing ran yet.
    expect(await second.harness.getTask(id, context)).toMatchObject({
      abortRequested: false,
      memos: { requested: 7 },
      state: { status: "pending", checkpoint: { phase: "apply", key: `transfer-${id}` } },
    });
    expect(service.calls).toBe(1);
    second.harness.resume();
    const receipt = await second.harness.waitForTask(id, context);
    expect(receipt.state.outcome).toEqual({ status: "completed", result: { receipt: 70 } });
    expect(service.calls).toBe(2);
    expect(service.applied.size).toBe(1);
    await second.harness.close(context);

    const third = await openTasks(await openNodeSqliteStorage(path), [Transfer]);
    expect(await third.harness.getTask(id, context)).toEqual(receipt);
    await third.harness.close(context);
  });
});

describe("task recovery", () => {
  // #10549
  it("keeps a task's startedAt across close and reopen and stamps endedAt when it settles", async () => {
    const path = await sqlitePath();
    const service = new TransferService();
    const Transfer = transferTask(service, { first: true });
    let clock = 2_000;
    const now = () => clock;

    const first = await openTasks(await openNodeSqliteStorage(path), [Transfer], { now });
    const root = await first.harness.root(context);
    const id = await root.commit(
      (tx) => tx.createTask(Transfer, { amount: 7 }, { ownership: { kind: "conversation" } }),
      context,
    );
    first.harness.resume();
    await eventually(() => service.calls === 1);
    clock = 3_000;
    await first.harness.close(context);

    clock = 9_000;
    const second = await openTasks(await openNodeSqliteStorage(path), [Transfer], { now });
    const reopened = await second.harness.getTask(id, context);
    expect([reopened?.state.status, reopened?.startedAt, reopened?.endedAt]).toEqual([
      "pending",
      2_000,
      undefined,
    ]);
    second.harness.resume();
    const receipt = await second.harness.waitForTask(id, context);
    expect([receipt.startedAt, receipt.endedAt]).toEqual([2_000, 9_000]);
    await second.harness.close(context);
  });
});

describe("task recovery", () => {
  it("resumes abort work after close at every direct-task abort stage", async () => {
    const { path, log, abortGate, abortReached, Abortable, id } = await abortMarkedAtClose();

    // Stage 2: reopen dispatches the abort invocation, never the run; close while it is active.
    const reopened = await openTasks(await openNodeSqliteStorage(path), [Abortable]);
    expect(await reopened.harness.getTask(id, context)).toMatchObject({
      abortRequested: true,
      state: { status: "pending" },
    });
    reopened.harness.resume();
    await abortReached.promise;
    await reopened.harness.close(context);
    expect(log).toEqual(["run", "abort"]);

    // Stage 3: a fresh abort invocation settles the task.
    abortGate.block = false;
    const unblocked = await openTasks(await openNodeSqliteStorage(path), [Abortable]);
    unblocked.harness.resume();
    expect((await unblocked.harness.waitForTask(id, context)).state.outcome).toEqual({
      status: "aborted",
      reason: "stop",
    });
    await unblocked.harness.close(context);
    expect(log).toEqual(["run", "abort", "abort"]);

    // Stage 4: the terminal receipt survives reopen and nothing runs again.
    const settled = await openTasks(await openNodeSqliteStorage(path), [Abortable]);
    settled.harness.resume();
    await flush();
    expect(await settled.harness.abortTask(id, context)).toBe("terminal");
    await settled.harness.close(context);
    expect(log).toEqual(["run", "abort", "abort"]);
  });
});
