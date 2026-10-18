import { defineDoc, defineTask } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { abortController, awaited } from "./effect-support.ts";
import { start, oneStep, withSignal, openRoot, markDurably } from "./harness-tasks-support.ts";
import { ControlledStorage, context, flush } from "./session-support.ts";
import { abortMarked, aborted, abortedWith, deferred, eventually } from "./task-support.ts";

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
    status: "aborted",
    reason: "once",
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
    status: "aborted",
    reason: "done",
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
    status: "aborted",
    reason: "test",
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
  let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
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
    status: "aborted",
    reason: "test",
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
    name: "test.two",
    version: 1,
    initial: () => ({ phase: "one" }),
    phases: {
      one: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            phases.push("one");
            yield* awaited(
              runtime.commit(() => ({ status: "running", checkpoint: { phase: "two" } }), ctx),
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
    abort: () => {
      seen.abortRan = true;

      return Promise.resolve();
    },
  });
  return { reached, proceed, phases, seen, Two };
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
    state: { status: "running", checkpoint: { phase: "two" } },
  });
  yield* awaited(expect(harness.commit(() => {}, context)).rejects.toThrow("closed"));
});

describe("task close", () => {
  it("stops without outcomes and starts no fresh phase or abort invocation while closing", () =>
    Effect.runPromise(stopsWithoutOutcomes));
});

const sealsAdmissionSignalling = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Notes = defineDoc<{ text: string }>({
    kind: "test.close-notes",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  const reached = deferred();
  let fromListener: Promise<unknown> | undefined;
  let harnessRef: Effect.Success<ReturnType<typeof openRoot>>["harness"] | undefined;
  let watchEnd: unknown;
  const Stubborn = oneStep("test.stubborn", (_task, runtime) =>
    runPromise(
      Effect.gen(function* () {
        const watch = yield* awaited(runtime.watchDoc(Notes, context));
        runtime.signal.addEventListener("abort", () => {
          fromListener = harnessRef!.commit(() => {}, context);
        });
        reached.resolve();
        watchEnd = yield* awaited(watch!.closed);
      }),
    ),
  );
  const { harness, root } = yield* openRoot([Stubborn]);
  harnessRef = harness;
  yield* awaited(
    harness.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(Notes))).text = "x";
          }),
        ),
      context,
    ),
  );
  yield* awaited(start(root, Stubborn));
  harness.resume();
  yield* awaited(reached.promise);
  yield* awaited(harness.close(context));
  yield* awaited(expect(fromListener).rejects.toThrow("closed"));
  expect(watchEnd).toEqual({ reason: "session_closed" });
});

describe("task close", () => {
  it("seals admission before signalling handlers and stops watches before joining them", () =>
    Effect.runPromise(sealsAdmissionSignalling));
});

const writesNoFault = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
  let harnessRef: Effect.Success<ReturnType<typeof openRoot>>["harness"] | undefined;
  const Throws = oneStep("test.close-fault", (_task, runtime) => {
    held = storage.holdCommits();
    void harnessRef!.commit(
      (tx) =>
        runPromise(
          Effect.asVoid(
            Effect.suspend(() =>
              awaited(tx.appendEntry(runtime.conversationId, { kind: "blocker" })),
            ),
          ),
        ),
      context,
    );
    return Promise.reject(new Error("would fault"));
  });
  const { harness, root } = yield* openRoot([Throws], { storage });
  harnessRef = harness;
  const id = yield* awaited(start(root, Throws));
  harness.resume();
  yield* eventually(() => held !== undefined);
  yield* awaited(held!.entered);
  yield* flush;
  const closing = harness.close(context);
  held!.release();
  yield* awaited(closing);
  const taskWrites = storage.commits.flatMap((writes) =>
    writes.filter((write) => write.type === "task" && write.value.id === id),
  );
  expect(
    taskWrites.map((write) => (write.type === "task" ? write.value.state.status : "")),
  ).toEqual(["pending", "running"]);
});

describe("task close", () => {
  it("writes no fault when close seals while the step after a failed phase is queued", () =>
    Effect.runPromise(writesNoFault));
});
