import { Type } from "@msa/ai";
import { defineTask, defineTool, type RegistrySnapshot, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
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
      wait: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            order.push("wait");
            const checkpoint = { phase: "resume" } as const;
            yield* awaited(
              runtime.commit(
                () => ({ status: "waiting", checkpoint, on: waiting.on, policy: "allSettled" }),
                ctx,
              ),
            );
          }),
        ),
      resume: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            order.push("resume");
            waiting.outcomes = (yield* awaited(runtime.outcomes(waiting.on, ctx))).map(
              (outcome) => outcome.status,
            );
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    abort: (_task, runtime, ctx) => Promise.resolve(runtime.commit(() => abortedWith("test"), ctx)),
  });
  const First = oneStep("test.first", (_task, runtime, ctx) =>
    Effect.runPromise(
      Effect.gen(function* () {
        order.push("first");
        yield* awaited(gate.promise);
        yield* awaited(runtime.commit(() => completed(null), ctx));
      }),
    ),
  );
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
      a: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const before = runtime.registry;
            entered.resolve();
            yield* awaited(phaseGate.promise);
            seen.push({
              phase: "a",
              tools: tools(runtime.registry),
              same: runtime.registry === before,
            });
            yield* awaited(
              runtime.commit(() => ({ status: "running", checkpoint: { phase: "b" } }), ctx),
            );
          }),
        ),
      b: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            seen.push({ phase: "b", tools: tools(runtime.registry), same: true });
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    abort: () => Promise.resolve(),
  });
  return { seen, phaseGate, entered, Snapshots };
}

const resumesWaitingTask = Effect.gen(function* () {
  const { gate, order, waiting, Waiter, First, Faulting } = waiterTasks();
  const { harness, root } = yield* openRoot([First, Faulting, Waiter]);
  const first = yield* awaited(start(root, First));
  const faulting = yield* awaited(start(root, Faulting));
  waiting.on = [first, faulting];
  const waiter = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Waiter, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  harness.resume();
  yield* eventually(() => order.length === 3);
  yield* flush;
  expect(order.sort()).toEqual(["faulting", "first", "wait"]);
  expect((yield* awaited(harness.getTask(waiter, context)))?.state).toMatchObject({
    status: "waiting",
    on: waiting.on,
  });
  gate.resolve();
  yield* awaited(harness.waitForTask(waiter, context));
  expect(order.at(-1)).toBe("resume");
  expect(waiting.outcomes).toEqual(["completed", "faulted"]);
  yield* awaited(harness.close(context));
});

describe("task phases", () => {
  it("resumes a waiting task once every task in `on` is terminal, whatever the outcome", () =>
    Effect.runPromise(resumesWaitingTask));
});

const stampsStartedAtFirst = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { timing, gate, Waiter, Held } = timedWaiter();
  const { harness, root } = yield* openRoot([Waiter, Held], { now: () => timing.clock });
  const held = yield* awaited(start(root, Held));
  timing.on = [held];
  const waiter = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Waiter, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  const times = () =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(harness.inspect(context))).tasks.map(({ record }) => [
          record.id,
          record.startedAt,
          record.endedAt,
        ]);
      }),
    );
  expect(yield* awaited(times())).toEqual([
    [held, undefined, undefined],
    [waiter, undefined, undefined],
  ]);

  timing.clock = 2_000;
  harness.resume();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(harness.getTask(waiter, context)))?.state.status === "waiting";
      }),
    ),
  );
  expect(yield* awaited(times())).toEqual([
    [held, 2_000, undefined],
    [waiter, 2_000, undefined],
  ]);

  timing.clock = 5_000;
  gate.resolve();
  const settledWaiter = yield* awaited(harness.waitForTask(waiter, context));
  const settledHeld = yield* awaited(harness.getTask(held, context));
  expect([settledHeld?.startedAt, settledHeld?.endedAt]).toEqual([2_000, 5_000]);
  expect([settledWaiter.startedAt, settledWaiter.endedAt]).toEqual([2_000, 5_000]);
  yield* awaited(harness.close(context));
});

describe("task phases", () => {
  it("stamps startedAt at the first run and endedAt when terminal, keeping startedAt through a wait", () =>
    Effect.runPromise(stampsStartedAtFirst));
});

const keepsOneRegistry = Effect.gen(function* () {
  const { seen, phaseGate, entered, Snapshots } = snapshotTask();
  const { harness, registry, root } = yield* openRoot([Snapshots]);
  const id = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Snapshots, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  harness.resume();
  yield* awaited(entered.promise);
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
  yield* awaited(harness.waitForTask(id, context));
  expect(seen).toEqual([
    { phase: "a", tools: [], same: true },
    { phase: "b", tools: ["late"], same: true },
  ]);
  yield* awaited(harness.close(context));
});

describe("task phases", () => {
  it("keeps one registry snapshot per phase and refreshes it at the phase boundary", () =>
    Effect.runPromise(keepsOneRegistry));
});
