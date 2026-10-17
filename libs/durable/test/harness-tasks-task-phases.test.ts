import { Type } from "@msa/ai";
import { defineTask, defineTool, type RegistrySnapshot, type TaskId } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { addTool } from "./harness-support.ts";
import { start, oneStep, gated, openRoot } from "./harness-tasks-support.ts";
import { context, flush } from "./session-support.ts";
import { abortedWith, completed, deferred, eventually } from "./task-support.ts";

function waiterTasks() {
  const gate = deferred();
  const order: string[] = [];
  const waiting: { on: TaskId[]; outcomes: string[] } = { on: [], outcomes: [] };
  const Waiter = defineTask<null, { phase: "wait" } | { phase: "resume" }, null>({
    name: "test.waiter",
    version: 1,
    initial: () => ({ phase: "wait" }),
    phases: {
      wait: async (_task, runtime, ctx) => {
        order.push("wait");
        const checkpoint = { phase: "resume" } as const;
        await runtime.commit(
          () => ({ status: "waiting", checkpoint, on: waiting.on, policy: "allSettled" }),
          ctx,
        );
      },
      resume: async (_task, runtime, ctx) => {
        order.push("resume");
        waiting.outcomes = (await runtime.outcomes(waiting.on, ctx)).map(
          (outcome) => outcome.status,
        );
        await runtime.commit(() => completed(null), ctx);
      },
    },
    abort: (_task, runtime, ctx) => Promise.resolve(runtime.commit(() => abortedWith("test"), ctx)),
  });
  const First = oneStep("test.first", async (_task, runtime, ctx) => {
    order.push("first");
    await gate.promise;
    await runtime.commit(() => completed(null), ctx);
  });
  const Faulting = oneStep("test.faulting", () => {
    order.push("faulting");
    return Promise.reject(new Error("fails"));
  });
  return { gate, order, waiting, Waiter, First, Faulting };
}

function timedWaiter() {
  const timing: { clock: number; on: TaskId[] } = { clock: 1_000, on: [] };
  const gate = deferred();
  const Waiter = defineTask<null, { phase: "wait" } | { phase: "resume" }, null>({
    name: "test.timed-waiter",
    version: 1,
    initial: () => ({ phase: "wait" }),
    phases: {
      wait: (_task, runtime, ctx) => {
        const checkpoint = { phase: "resume" } as const;
        return runtime.commit(
          () => ({ status: "waiting", checkpoint, on: timing.on, policy: "allSettled" }),
          ctx,
        );
      },
      resume: (_task, runtime, ctx) => runtime.commit(() => completed(null), ctx),
    },
    abort: (_task, runtime, ctx) => Promise.resolve(runtime.commit(() => abortedWith("test"), ctx)),
  });
  const Held = gated("test.timed-held", gate.promise);
  return { timing, gate, Waiter, Held };
}

function snapshotTask() {
  const seen: { phase: string; tools: string[]; same: boolean }[] = [];
  const phaseGate = deferred();
  const entered = deferred();
  const tools = (snapshot: RegistrySnapshot) => snapshot.tools().map(({ tool }) => tool.name);
  const Snapshots = defineTask<null, { phase: "a" } | { phase: "b" }, null>({
    name: "test.snapshots",
    version: 1,
    initial: () => ({ phase: "a" }),
    phases: {
      a: async (_task, runtime, ctx) => {
        const before = runtime.registry;
        entered.resolve();
        await phaseGate.promise;
        seen.push({
          phase: "a",
          tools: tools(runtime.registry),
          same: runtime.registry === before,
        });
        await runtime.commit(() => ({ status: "running", checkpoint: { phase: "b" } }), ctx);
      },
      b: async (_task, runtime, ctx) => {
        seen.push({ phase: "b", tools: tools(runtime.registry), same: true });
        await runtime.commit(() => completed(null), ctx);
      },
    },
    abort: async () => {},
  });
  return { seen, phaseGate, entered, Snapshots };
}

describe("task phases", () => {
  it("resumes a waiting task once every task in `on` is terminal, whatever the outcome", async () => {
    const { gate, order, waiting, Waiter, First, Faulting } = waiterTasks();
    const { harness, root } = await openRoot([First, Faulting, Waiter]);
    const first = await start(root, First);
    const faulting = await start(root, Faulting);
    waiting.on = [first, faulting];
    const waiter = await root.commit(
      (tx) => tx.createTask(Waiter, null, { ownership: { kind: "conversation" } }),
      context,
    );
    harness.resume();
    await eventually(() => order.length === 3);
    await flush();
    expect(order.sort()).toEqual(["faulting", "first", "wait"]);
    expect((await harness.getTask(waiter, context))?.state).toMatchObject({
      status: "waiting",
      on: waiting.on,
    });
    gate.resolve();
    await harness.waitForTask(waiter, context);
    expect(order.at(-1)).toBe("resume");
    expect(waiting.outcomes).toEqual(["completed", "faulted"]);
    await harness.close(context);
  });
});

describe("task phases", () => {
  // #10549
  it("stamps startedAt at the first run and endedAt when terminal, keeping startedAt through a wait", async () => {
    const { timing, gate, Waiter, Held } = timedWaiter();
    const { harness, root } = await openRoot([Waiter, Held], { now: () => timing.clock });
    const held = await start(root, Held);
    timing.on = [held];
    const waiter = await root.commit(
      (tx) => tx.createTask(Waiter, null, { ownership: { kind: "conversation" } }),
      context,
    );
    const times = async () =>
      (await harness.inspect(context)).tasks.map(({ record }) => [
        record.id,
        record.startedAt,
        record.endedAt,
      ]);
    expect(await times()).toEqual([
      [held, undefined, undefined],
      [waiter, undefined, undefined],
    ]);

    timing.clock = 2_000;
    harness.resume();
    await eventually(
      async () => (await harness.getTask(waiter, context))?.state.status === "waiting",
    );
    expect(await times()).toEqual([
      [held, 2_000, undefined],
      [waiter, 2_000, undefined],
    ]);

    // The waiter runs again at 5_000; its start stays the first run.
    timing.clock = 5_000;
    gate.resolve();
    const settledWaiter = await harness.waitForTask(waiter, context);
    const settledHeld = await harness.getTask(held, context);
    expect([settledHeld?.startedAt, settledHeld?.endedAt]).toEqual([2_000, 5_000]);
    expect([settledWaiter.startedAt, settledWaiter.endedAt]).toEqual([2_000, 5_000]);
    await harness.close(context);
  });
});

describe("task phases", () => {
  it("keeps one registry snapshot per phase and refreshes it at the phase boundary", async () => {
    const { seen, phaseGate, entered, Snapshots } = snapshotTask();
    const { harness, registry, root } = await openRoot([Snapshots]);
    const id = await root.commit(
      (tx) => tx.createTask(Snapshots, null, { ownership: { kind: "conversation" } }),
      context,
    );
    harness.resume();
    await entered.promise;
    addTool(
      registry,
      defineTool({
        name: "late",
        description: "late",
        parameters: Type.Object({}),
        execute: () => Promise.resolve({}),
      }),
    );
    phaseGate.resolve();
    await harness.waitForTask(id, context);
    expect(seen).toEqual([
      { phase: "a", tools: [], same: true },
      { phase: "b", tools: ["late"], same: true },
    ]);
    await harness.close(context);
  });
});
