import durable from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessTasksSupport from "./harness-tasks-support.ts";
import sessionSupport from "./session-support.ts";
import type sessionSupportTypes from "./session-support.types.ts";
import taskSupport from "./task-support.ts";

const { defineTask } = durable;

const { abortController, awaited } = effectSupport;
const { markDurably, oneStep, openRoot, start, withSignal } = harnessTasksSupport;
const { ControlledStorage, context, flush } = sessionSupport;
const { abortMarked, aborted, abortedWith, deferred, eventually } = taskSupport;

const doesNotSignal = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const reached = deferred();
  const proceed = deferred();
  const runRelease = deferred();
  let abortSignalled: boolean | undefined;
  let aborts = 0;
  const Run = oneStep(
    "test.abort-again",
    () => runPromise(Effect.asVoid(Effect.suspend(() => awaited(runRelease.promise)))),
    (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          aborts++;
          reached.resolve();
          yield* awaited(proceed.promise);
          abortSignalled = runtime.signal.aborted;
          yield* awaited(runtime.commit(() => abortedWith("once"), ctx));
        }),
      ),
  );
  const { harness, root } = yield* openRoot([Run]);
  const id = yield* awaited(start(root, Run));
  harness.resume();
  yield* flush;
  const controller = abortController();
  const cancelled = harness.abortTask(id, withSignal(controller.signal));
  yield* abortMarked(harness, id);
  controller.abort(new Error("caller gave up"));
  yield* awaited(expect(cancelled).rejects.toThrow("caller gave up"));
  runRelease.resolve();
  yield* awaited(reached.promise);
  expect(yield* awaited(harness.abortTask(id, context))).toBe("marked");
  proceed.resolve();
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    reason: "once",
    status: "aborted",
  });
  expect(abortSignalled).toBe(false);
  expect(aborts).toBe(1);
  yield* awaited(harness.close(context));
});

describe("task abort", () => {
  it("does not signal a running abort handler when aborted again, and a cancelled caller leaves the mark durable", () =>
    Effect.runPromise(doesNotSignal));
});

const keepsTerminalOutcome = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Run = oneStep(
    "test.abort-then-throw",
    (_task, runtime) => runPromise(Effect.suspend(() => awaited(aborted(runtime.signal)))),
    (runtime, ctx) =>
      runPromise(
        Effect.gen(function* () {
          yield* awaited(runtime.commit(() => abortedWith("done"), ctx));
          throw new Error("after terminal");
        }),
      ),
  );
  const { harness, root } = yield* openRoot([Run]);
  const id = yield* awaited(start(root, Run));
  harness.resume();
  yield* flush;
  yield* awaited(harness.abortTask(id, context));
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    reason: "done",
    status: "aborted",
  });
  yield* awaited(harness.close(context));
});

const neverStartsPhase = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let ran = false;
  const Reserved = oneStep("test.reserved", (_task, runtime) =>
    runPromise(
      Effect.gen(function* () {
        ran = true;
        return yield* awaited(aborted(runtime.signal));
      }),
    ),
  );
  const storage = new ControlledStorage();
  const { harness, root } = yield* openRoot([Reserved], { storage });
  const id = yield* awaited(start(root, Reserved));
  const held = storage.holdCommits();
  harness.resume();
  yield* awaited(held.entered);
  const aborting = harness.abortTask(id, context);
  held.release();
  expect(yield* awaited(aborting)).toBe("marked");
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    reason: "test",
    status: "aborted",
  });
  expect(ran).toBe(false);
  yield* awaited(harness.close(context));
});

describe("task abort", () => {
  it("keeps a terminal outcome committed by an abort handler that throws afterwards", () =>
    Effect.runPromise(keepsTerminalOutcome));

  it("never starts phase one when the abort lands while the reservation settles", () =>
    Effect.runPromise(neverStartsPhase));
});

const letsAbortMark = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  let marking: Promise<unknown> | undefined;
  let held: ReturnType<sessionSupportTypes.ControlledStorage["holdCommits"]> | undefined;
  let harnessRef: Effect.Success<ReturnType<typeof openRoot>>["harness"] | undefined;
  const Racing = oneStep("test.racing-fault", (task) =>
    runPromise(
      Effect.gen(function* () {
        held = storage.holdCommits();
        marking = harnessRef!.abortTask(task.id, context);
        yield* awaited(held.entered);
        throw new Error("would fault");
      }),
    ),
  );
  const { harness, root } = yield* openRoot([Racing], { storage });
  harnessRef = harness;
  const id = yield* awaited(start(root, Racing));
  harness.resume();
  yield* eventually(() => held !== undefined);
  yield* awaited(held!.entered);
  yield* flush;
  held!.release();
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    reason: "test",
    status: "aborted",
  });
  expect(yield* awaited(marking)).toBe("marked");
  yield* awaited(harness.close(context));
});

describe("task abort", () => {
  it("lets an abort mark win over a fault that races it", () => Effect.runPromise(letsAbortMark));
});

function twoPhaseTask() {
  const reached = deferred();
  const proceed = deferred();
  const phases: string[] = [];
  const seen: { abortRan: boolean } = { abortRan: false };
  const Two = defineTask<null, { phase: "one" } | { phase: "two" }, null>({
    abort: () => {
      seen.abortRan = true;

      return Promise.resolve();
    },
    initial: () => ({ phase: "one" }),
    name: "test.two",
    phases: {
      one: (_task, runtime, ctx) =>
        Effect.runPromise(
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
  return { Two, phases, proceed, reached, seen };
}

const stopsWithoutOutcomes = Effect.gen(function* () {
  const { reached, proceed, phases, seen, Two } = twoPhaseTask();
  const storage = new ControlledStorage();
  const { harness, root } = yield* openRoot([Two], { storage });
  const id = yield* awaited(
    root.commit((tx) => tx.createTask(Two, null, { ownership: { kind: "conversation" } }), context),
  );
  harness.resume();
  yield* awaited(reached.promise);
  const { aborting } = yield* markDurably(harness, id);
  const record = yield* awaited(harness.getTask(id, context));
  const commits = storage.commits.length;
  const closing = harness.close(context);
  proceed.resolve();
  yield* awaited(closing);
  expect(yield* awaited(aborting)).toBe("marked");
  expect(storage.commits.length).toBe(commits);
  expect(phases).toEqual(["one"]);
  expect(seen.abortRan).toBe(false);
  expect(record).toMatchObject({
    abortRequested: true,
    state: { checkpoint: { phase: "two" }, status: "running" },
  });
  yield* awaited(expect(harness.commit(() => {}, context)).rejects.toThrow("closed"));
});

describe("task close", () => {
  it("stops without outcomes and starts no fresh phase or abort invocation while closing", () =>
    Effect.runPromise(stopsWithoutOutcomes));
});
