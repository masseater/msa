import { Type } from "@msa/ai";
import { type RegistrySnapshot, type TaskId, defineTask, defineTool } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessSupport from "./harness-support.ts";
import harnessTasksSupport from "./harness-tasks-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { addTool } = harnessSupport;
const { gated, oneStep, openRoot, start } = harnessTasksSupport;
const { context, flush } = sessionSupport;
const { abortedWith, completed, deferred, eventually } = taskSupport;

function waiterTasks() {
  const gate = deferred();
  const order: string[] = [];
  const waiting: { on: TaskId[]; outcomes: string[] } = { on: [], outcomes: [] };
  const Waiter = defineTask<null, { phase: "wait" } | { phase: "resume" }, null>({
    abort: (_task, runtime, ctx) => Promise.resolve(runtime.commit(() => abortedWith("test"), ctx)),
    initial: () => ({ phase: "wait" }),
    name: "test.waiter",
    phases: {
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
      wait: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            order.push("wait");
            const checkpoint = { phase: "resume" } as const;
            yield* awaited(
              runtime.commit(
                () => ({ checkpoint, on: waiting.on, policy: "allSettled", status: "waiting" }),
                ctx,
              ),
            );
          }),
        ),
    },
    version: 1,
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
  return { Faulting, First, Waiter, gate, order, waiting };
}

function timedWaiter() {
  const timing: { clock: number; on: TaskId[] } = { clock: 1_000, on: [] };
  const gate = deferred();
  const Waiter = defineTask<null, { phase: "wait" } | { phase: "resume" }, null>({
    abort: (_task, runtime, ctx) => Promise.resolve(runtime.commit(() => abortedWith("test"), ctx)),
    initial: () => ({ phase: "wait" }),
    name: "test.timed-waiter",
    phases: {
      resume: (_task, runtime, ctx) => runtime.commit(() => completed(null), ctx),
      wait: (_task, runtime, ctx) => {
        const checkpoint = { phase: "resume" } as const;
        return runtime.commit(
          () => ({ checkpoint, on: timing.on, policy: "allSettled", status: "waiting" }),
          ctx,
        );
      },
    },
    version: 1,
  });
  const Held = gated("test.timed-held", gate.promise);
  return { Held, Waiter, gate, timing };
}

function snapshotTask() {
  const seen: { phase: string; tools: string[]; same: boolean }[] = [];
  const phaseGate = deferred();
  const entered = deferred();
  const tools = (snapshot: RegistrySnapshot) => snapshot.tools().map(({ tool }) => tool.name);
  const Snapshots = defineTask<null, { phase: "a" } | { phase: "b" }, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ phase: "a" }),
    name: "test.snapshots",
    phases: {
      a: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const before = runtime.registry;
            entered.resolve();
            yield* awaited(phaseGate.promise);
            seen.push({
              phase: "a",
              same: runtime.registry === before,
              tools: tools(runtime.registry),
            });
            yield* awaited(
              runtime.commit(() => ({ checkpoint: { phase: "b" }, status: "running" }), ctx),
            );
          }),
        ),
      b: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            seen.push({ phase: "b", same: true, tools: tools(runtime.registry) });
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    version: 1,
  });
  return { Snapshots, entered, phaseGate, seen };
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
    on: waiting.on,
    status: "waiting",
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
      description: "late",
      execute: () => Promise.resolve({}),
      name: "late",
      parameters: Type.Object({}),
    }),
  );
  phaseGate.resolve();
  yield* awaited(harness.waitForTask(id, context));
  expect(seen).toEqual([
    { phase: "a", same: true, tools: [] },
    { phase: "b", same: true, tools: ["late"] },
  ]);
  yield* awaited(harness.close(context));
});

describe("task phases", () => {
  it("keeps one registry snapshot per phase and refreshes it at the phase boundary", () =>
    Effect.runPromise(keepsOneRegistry));
});
