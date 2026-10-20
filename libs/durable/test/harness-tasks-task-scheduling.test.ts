import { type TaskId, defineTask } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessTasksSupport from "./harness-tasks-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { abortController, awaited } = effectSupport;
const { gated, markDurably, oneStep, openRoot, start, withSignal } = harnessTasksSupport;
const { ControlledStorage, context, flush } = sessionSupport;
const { aborted, abortedWith, completed, deferred } = taskSupport;

const pagesNewestTasks = Effect.gen(function* () {
  const Idle = oneStep("test.idle", () => Promise.resolve());
  const { harness, root } = yield* openRoot([Idle]);
  const ids: TaskId[] = [];
  for (const _ of Array.from({ length: 5 })) ids.push(yield* awaited(start(root, Idle)));
  const first = yield* awaited(
    harness.commit((tx) => tx.scanTasks({ order: "descending" }, 2), context),
  );
  expect(first.items.map(({ id }) => id)).toEqual([ids[4], ids[3]]);
  const second = yield* awaited(harness.commit((tx) => tx.scanTasks({}, 2, first.next), context));
  expect(second.items.map(({ id }) => id)).toEqual([ids[2], ids[1]]);
  yield* awaited(harness.close(context));
});

const rejectsUnknownTasks = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Done = oneStep("test.quick", (_task, runtime, ctx) =>
    runPromise(
      Effect.asVoid(Effect.suspend(() => awaited(runtime.commit(() => completed(null), ctx)))),
    ),
  );
  const { harness, root } = yield* openRoot([Done]);
  const unknown = 999_999 as TaskId;
  expect(yield* awaited(harness.getTask(unknown, context))).toBeUndefined();
  yield* awaited(expect(harness.waitForTask(unknown, context)).rejects.toThrow("does not exist"));
  yield* awaited(expect(harness.abortTask(unknown, context)).rejects.toThrow("does not exist"));
  const id = yield* awaited(start(root, Done));
  harness.resume();
  yield* awaited(harness.waitForTask(id, context));
  expect(yield* awaited(harness.waitForTask(id, context))).toMatchObject({
    state: { status: "terminal" },
  });
  expect(yield* awaited(harness.abortTask(id, context))).toBe("terminal");
  yield* awaited(harness.close(context));
  expect(() => harness.resume()).toThrow("closed");
});

describe("task scheduling", () => {
  it("pages the newest tasks first without scanning older ones", () =>
    Effect.runPromise(pagesNewestTasks));

  it("rejects unknown tasks and reports terminal tasks", () =>
    Effect.runPromise(rejectsUnknownTasks));
});

const rejectsTaskWaits = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const gate = deferred();
  const Blocking = gated("test.wait-close", gate.promise);
  const storage = new ControlledStorage();
  const { harness, root } = yield* openRoot([Blocking], { storage });
  const id = yield* awaited(start(root, Blocking));

  const held = storage.holdCommits();
  const blocker = harness.commit(
    (tx) =>
      runPromise(
        Effect.asVoid(Effect.suspend(() => awaited(tx.appendEntry(root.id, { kind: "blocker" })))),
      ),
    context,
  );
  yield* awaited(held.entered);
  const controller = abortController();
  const cancelledWhileQueued = harness.waitForTask(id, withSignal(controller.signal));
  controller.abort(new Error("wait cancelled"));
  held.release();
  yield* awaited(blocker);
  yield* awaited(expect(cancelledWhileQueued).rejects.toThrow("wait cancelled"));

  const pending = harness.waitForTask(id, context);
  const idle = harness.waitForIdle(context);
  const conversationIdle = root.waitForIdle(context);
  yield* flush;
  const heldAgain = storage.holdCommits();
  const blockerAgain = harness.commit(
    (tx) =>
      runPromise(
        Effect.asVoid(Effect.suspend(() => awaited(tx.appendEntry(root.id, { kind: "blocker" })))),
      ),
    context,
  );
  yield* awaited(heldAgain.entered);
  const closedWhileQueued = harness.waitForTask(id, context);
  const closing = harness.close(context);
  heldAgain.release();
  yield* awaited(blockerAgain);
  yield* awaited(expect(closedWhileQueued).rejects.toThrow("closed"));
  yield* awaited(expect(pending).rejects.toThrow("closed"));
  yield* awaited(expect(idle).rejects.toThrow("closed"));
  yield* awaited(expect(conversationIdle).rejects.toThrow("closed"));
  gate.resolve();
  yield* awaited(closing);
});

describe("task scheduling", () => {
  it("rejects task waits cancelled or closed while queued on the line, and pending waits on close", () =>
    Effect.runPromise(rejectsTaskWaits));
});

function markedTask() {
  const reached = deferred();
  const errors: string[] = [];
  const seen: { memoRead?: unknown; runRuntime?: unknown } = {};
  const abortRuntimes: unknown[] = [];
  const Marked = oneStep(
    "test.marked",
    (_task, runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          seen.runRuntime = runtime;
          yield* awaited(runtime.memo("kept", 1, ctx));
          reached.resolve();
          yield* awaited(aborted(runtime.signal).catch(() => {}));
          seen.memoRead = yield* awaited(runtime.memo("kept", context));
          yield* awaited(
            runtime
              .memo("late", 2, context)
              .catch((error: unknown) => errors.push((error as Error).message)),
          );
          yield* awaited(
            runtime
              .commit(() => completed(null), context)
              .catch((error: unknown) => {
                errors.push((error as Error).message);
              }),
          );
        }),
      ),
    (runtime, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          abortRuntimes.push(runtime);
          yield* awaited(
            runtime.commit((_tx, current) => {
              expect(current.abortRequested).toBe(true);
              expect(current.memos).toEqual({ kept: 1 });
              return abortedWith("mark");
            }, ctx),
          );
        }),
      ),
  );
  return { Marked, abortRuntimes, errors, reached, seen };
}

const rejectsRunCommits = Effect.gen(function* () {
  const { reached, errors, seen, abortRuntimes, Marked } = markedTask();
  const { harness, root } = yield* openRoot([Marked]);
  const id = yield* awaited(start(root, Marked));
  harness.resume();
  yield* awaited(reached.promise);
  expect(yield* awaited(harness.abortTask(id, context))).toBe("marked");
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    reason: "mark",
    status: "aborted",
  });
  expect(seen.memoRead).toBe(1);
  expect(errors).toEqual([
    `Task ${id} has a durable abort mark`,
    `Task ${id} has a durable abort mark`,
  ]);
  expect(abortRuntimes).toHaveLength(1);
  expect(abortRuntimes[0]).not.toBe(seen.runRuntime);
  yield* awaited(harness.close(context));
});

describe("task abort", () => {
  it("rejects the run's commits and memo writes after the mark, and settles through a fresh abort invocation", () =>
    Effect.runPromise(rejectsRunCommits));
});

const startsNoFurtherStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const reached = deferred();
  const proceed = deferred();
  const phases: string[] = [];
  const Two = defineTask<null, { phase: "one" } | { phase: "two" }, null>({
    abort: (_task, runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          phases.push("abort");
          yield* awaited(runtime.commit(() => abortedWith("boundary"), ctx));
        }),
      ),
    initial: () => ({ phase: "one" }),
    name: "test.mark-boundary",
    phases: {
      one: (_task, runtime, ctx) =>
        runPromise(
          Effect.gen(function* () {
            phases.push("one");
            yield* awaited(
              runtime.commit(() => ({ checkpoint: { phase: "two" }, status: "running" }), ctx),
            );
            reached.resolve();
            yield* awaited(proceed.promise);
          }),
        ),
      two: () => {
        phases.push("two");

        return Promise.resolve();
      },
    },
    version: 1,
  });
  const { harness, root } = yield* openRoot([Two]);
  const id = yield* awaited(
    root.commit((tx) => tx.createTask(Two, null, { ownership: { kind: "conversation" } }), context),
  );
  harness.resume();
  yield* awaited(reached.promise);
  const { aborting } = yield* markDurably(harness, id);
  proceed.resolve();
  return { aborting, harness, id, phases };
});

const startsNoFurther = Effect.gen(function* () {
  const { phases, harness, id, aborting } = yield* startsNoFurtherStep1;
  expect(yield* awaited(aborting)).toBe("marked");
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    reason: "boundary",
    status: "aborted",
  });
  expect(phases).toEqual(["one", "abort"]);
  yield* awaited(harness.close(context));
});

describe("task abort", () => {
  it("starts no further phase after a mark that lands during a phase with progress", () =>
    Effect.runPromise(startsNoFurther));
});
