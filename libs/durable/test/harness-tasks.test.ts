import durable from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessTasksSupport from "./harness-tasks-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { defineTask } = durable;

const { awaited } = effectSupport;
const { oneStep, openRoot, start } = harnessTasksSupport;
const { context } = sessionSupport;
const { completed, eventually } = taskSupport;

const continuesOneInvocation = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const seen: number[] = [];
  const runtimes = new Set<unknown>();
  const Counter = defineTask<{ to: number }, { phase: "count"; n: number }, number>({
    abort: () => Promise.resolve(),
    initial: () => ({ n: 0, phase: "count" }),
    name: "test.counter",
    phases: {
      count: (task, runtime, ctx) =>
        runPromise(
          Effect.gen(function* () {
            seen.push(task.state.checkpoint.n);
            runtimes.add(runtime);
            yield* awaited(
              runtime.commit((_tx, current) => {
                const n = current.state.checkpoint.n + 1;
                return n === task.input.to
                  ? completed(n)
                  : { checkpoint: { n, phase: "count" }, status: "running" };
              }, ctx),
            );
          }),
        ),
    },
    version: 1,
  });
  const { harness, root } = yield* openRoot([Counter]);
  const id = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Counter, { to: 3 }, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  harness.resume();
  const receipt = yield* awaited(harness.waitForTask(id, context));
  const result: number | undefined =
    receipt.state.outcome.status === "completed" ? receipt.state.outcome.result : undefined;
  expect(result).toBe(3);
  expect(seen).toEqual([0, 1, 2]);
  expect(runtimes.size).toBe(1);
  yield* awaited(harness.close(context));
});

describe("task phases", () => {
  it("continues one invocation through checkpoint progress and completes with a typed result", () =>
    Effect.runPromise(continuesOneInvocation));
});

const faultsPhaseWithout = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Idle = oneStep("test.idle", () => Promise.resolve());
  const DocumentOnly = oneStep("test.document-only", (_task, runtime, ctx) =>
    runPromise(Effect.asVoid(Effect.suspend(() => awaited(runtime.commit(() => undefined, ctx))))),
  );
  const Throws = oneStep("test.throws", () => Promise.reject(new Error("boom")));
  const { harness, root } = yield* openRoot([Idle, DocumentOnly, Throws]);
  const ids = [
    yield* awaited(start(root, Idle)),
    yield* awaited(start(root, DocumentOnly)),
    yield* awaited(start(root, Throws)),
  ];
  harness.resume();
  const outcomes = yield* awaited(
    Promise.all(
      ids.map((id) =>
        runPromise(
          Effect.gen(function* () {
            return (yield* awaited(harness.waitForTask(id, context))).state.outcome;
          }),
        ),
      ),
    ),
  );
  expect(outcomes).toEqual([
    {
      error: { message: "Task test.idle phase run returned without durable progress" },
      status: "faulted",
    },
    {
      error: {
        message: "Task test.document-only phase run returned without durable progress",
      },
      status: "faulted",
    },
    { error: { message: "boom" }, status: "faulted" },
  ]);
  yield* awaited(harness.close(context));
});

describe("task phases", () => {
  it("faults a phase without durable progress and a throwing phase", () =>
    Effect.runPromise(faultsPhaseWithout));
});

const keepsCommittedTerminal = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let lateCommit: unknown;
  const Done = oneStep<string>("test.done", (_task, runtime, ctx) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(runtime.commit(() => completed("ok"), ctx));
        lateCommit = yield* awaited(
          runtime.commit(() => undefined, ctx).catch((error: unknown) => error),
        );
        throw new Error("after terminal");
      }),
    ),
  );
  const { harness, root } = yield* openRoot([Done]);
  const id = yield* awaited(start(root, Done));
  harness.resume();
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    result: "ok",
    status: "completed",
  });
  yield* eventually(() => lateCommit !== undefined);
  expect(String(lateCommit)).toContain(`Task ${id} is terminal`);
  yield* awaited(harness.close(context));
});

describe("task phases", () => {
  it("keeps a committed terminal outcome when the handler throws afterwards", () =>
    Effect.runPromise(keepsCommittedTerminal));
});

const comparesCheckpointsValue = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Collect = defineTask<null, { phase: "collect"; items: string[] }, null>({
    abort: () => Promise.resolve(),
    initial: () => ({ items: [], phase: "collect" }),
    name: "test.collect",
    phases: {
      collect: (task, runtime, ctx) =>
        runPromise(
          Effect.gen(function* () {
            const items = task.state.checkpoint.items;
            const next = items.length < 2 ? [...items, `item${items.length}`] : [...items];
            yield* awaited(
              runtime.commit(
                () => ({ checkpoint: { items: next, phase: "collect" }, status: "running" }),
                ctx,
              ),
            );
          }),
        ),
    },
    version: 1,
  });
  const { harness, root } = yield* openRoot([Collect]);
  const id = yield* awaited(
    root.commit(
      (tx) => tx.createTask(Collect, null, { ownership: { kind: "conversation" } }),
      context,
    ),
  );
  harness.resume();
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    error: { message: "Task test.collect phase collect returned without durable progress" },
    status: "faulted",
  });
  yield* awaited(harness.close(context));
});

describe("task phases", () => {
  it("compares checkpoints by value, including arrays", () =>
    Effect.runPromise(comparesCheckpointsValue));
});
