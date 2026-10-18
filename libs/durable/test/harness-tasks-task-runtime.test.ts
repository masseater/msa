import { defineDoc, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { currentTimeMillis } from "../src/clock.ts";
import { abortController, awaited } from "./effect-support.ts";
import { start, oneStep, withSignal, openRoot } from "./harness-tasks-support.ts";
import { ControlledStorage, context } from "./session-support.ts";
import { completed, deferred, eventually, settled } from "./task-support.ts";

const ordersRuntimeCommits = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  let before: Promise<void> | undefined;
  let after: Promise<void> | undefined;
  let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
  let harnessRef: Effect.Success<ReturnType<typeof openRoot>>["harness"] | undefined;
  const Detached = oneStep<string>("test.detached", (_task, runtime) => {
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
    before = runtime.commit(() => completed("before"), context);
    void runPromise(
      Effect.sleep(1).pipe(
        Effect.andThen(
          Effect.sync(() => {
            after = runtime.commit(() => completed("after"), context);
          }),
        ),
      ),
    );

    return Promise.resolve();
  });
  const { harness, root } = yield* openRoot([Detached], { storage });
  harnessRef = harness;
  const id = yield* awaited(start(root, Detached));
  harness.resume();
  yield* eventually(() => held !== undefined);
  yield* awaited(held!.entered);
  yield* eventually(() => after !== undefined);
  held!.release();
  yield* awaited(before);
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    status: "completed",
    result: "before",
  });
  yield* awaited(expect(after).rejects.toThrow(/invocation has ended|is terminal/u));
  yield* awaited(harness.close(context));
});

describe("task runtime", () => {
  it("orders runtime commits against the step: one queued before it lands, one after it rejects", () =>
    Effect.runPromise(ordersRuntimeCommits));
});

const stopsWatchAcquisition = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Notes = defineDoc<{ text: string }>({
    kind: "test.late-watch",
    version: 1,
    scope: "session",
    initial: () => ({ text: "" }),
  });
  const storage = new ControlledStorage();
  let watching: Promise<unknown> | undefined;
  let held: ReturnType<ControlledStorage["holdCommits"]> | undefined;
  let harnessRef: Effect.Success<ReturnType<typeof openRoot>>["harness"] | undefined;
  const Late = oneStep("test.late-watch", (_task, runtime) => {
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
    void runPromise(
      Effect.sleep(1).pipe(
        Effect.andThen(
          Effect.sync(() => {
            watching = runtime.watchDoc(Notes, context).catch((error: unknown) => error);
          }),
        ),
      ),
    );

    return Promise.resolve();
  });
  const { harness, root } = yield* openRoot([Late], { storage });
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
  const id = yield* awaited(start(root, Late));
  harness.resume();
  yield* eventually(() => held !== undefined);
  yield* awaited(held!.entered);
  yield* eventually(() => watching !== undefined);
  held!.release();
  expect(String(yield* awaited(watching))).toContain("invocation has ended");
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toMatchObject({
    status: "faulted",
  });
  yield* awaited(harness.close(context));
});

describe("task runtime", () => {
  it("stops a watch whose acquisition finishes after the invocation ended", () =>
    Effect.runPromise(stopsWatchAcquisition));
});

const sleepsUntilHarness = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let clock = 1_000;
  const woke = deferred();
  const Sleeper = oneStep("test.sleeper", (_task, runtime, ctx) =>
    runPromise(
      Effect.gen(function* () {
        yield* awaited(runtime.sleep(900, ctx));
        yield* awaited(runtime.sleep(1_005, ctx));
        woke.resolve();
        yield* awaited(runtime.commit(() => completed(null), ctx));
      }),
    ),
  );
  const { harness, root } = yield* openRoot([Sleeper], { now: () => clock });
  const id = yield* awaited(start(root, Sleeper));
  harness.resume();
  yield* Effect.sleep(30);
  expect(yield* settled(woke.promise)).toBe(false);
  clock = 1_005;
  yield* awaited(harness.waitForTask(id, context));
  yield* awaited(harness.close(context));
});

describe("task runtime", () => {
  it("sleeps until the Harness clock reaches the deadline, rechecking after each timer", () =>
    Effect.runPromise(sleepsUntilHarness));
});

const rejectsSleepInvocation = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const results: string[] = [];
  const sleeping = deferred();
  const Signalled = oneStep("test.sleep-signalled", (_task, runtime, ctx) =>
    runPromise(
      Effect.gen(function* () {
        sleeping.resolve();
        yield* awaited(
          runtime.sleep(currentTimeMillis() + 60_000, ctx).catch((error: unknown) => {
            results.push(`signalled:${(error as Error).name}`);
            throw error;
          }),
        );
      }),
    ),
  );
  const Cancelled = oneStep("test.sleep-cancelled", (_task, runtime, ctx) =>
    runPromise(
      Effect.gen(function* () {
        const controller = abortController();
        const sleeping = runtime.sleep(currentTimeMillis() + 60_000, withSignal(controller.signal));
        controller.abort(new Error("stop sleeping"));
        yield* awaited(
          sleeping.catch((error: unknown) => results.push(`cancelled:${(error as Error).message}`)),
        );
        yield* awaited(runtime.commit(() => completed(null), ctx));
      }),
    ),
  );
  const { harness, root } = yield* openRoot([Signalled, Cancelled]);
  const signalled = yield* awaited(start(root, Signalled));
  const cancelled = yield* awaited(start(root, Cancelled));
  harness.resume();
  yield* awaited(harness.waitForTask(cancelled, context));
  yield* awaited(sleeping.promise);
  yield* awaited(harness.abortTask(signalled, context));
  expect((yield* awaited(harness.waitForTask(signalled, context))).state.outcome).toEqual({
    status: "aborted",
    reason: "test",
  });
  expect(results).toEqual(["cancelled:stop sleeping", "signalled:AbortError"]);
  yield* awaited(harness.close(context));
});

describe("task runtime", () => {
  it("rejects a sleep when the invocation is signalled or the sleep's own context is cancelled", () =>
    Effect.runPromise(rejectsSleepInvocation));
});

const failsHarnessFailed = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  let runs = 0;
  const Once = oneStep("test.once", (_task, runtime, ctx) =>
    runPromise(
      Effect.gen(function* () {
        runs++;
        yield* awaited(runtime.commit(() => completed(null), ctx));
      }),
    ),
  );
  const storage = new ControlledStorage();
  const { harness, root, reports } = yield* openRoot([Once], { storage });
  const id = yield* awaited(start(root, Once));
  const waiting = harness.waitForTask(id, context);
  const failure = new Error("disk gone");
  storage.failNextCommit(failure);
  harness.resume();
  const end = yield* awaited(harness.closed);
  expect(end).toEqual({ reason: "failed", error: failure });
  expect(reports).toEqual([failure]);
  yield* awaited(expect(waiting).rejects.toMatchObject({ name: "SessionFailed", cause: failure }));
  yield* awaited(
    expect(harness.getTask(id, context)).rejects.toMatchObject({
      name: "SessionFailed",
      cause: failure,
    }),
  );
  yield* awaited(
    expect(root.submit({ type: "input", content: "x" }, context)).rejects.toMatchObject({
      name: "SessionFailed",
    }),
  );
  expect(runs).toBe(0);
  yield* awaited(harness.close(context));

  const reopened = yield* openRoot([Once], { storage: storage.reopen() });
  reopened.harness.resume();
  expect((yield* awaited(reopened.harness.waitForTask(id, context))).state.outcome.status).toBe(
    "completed",
  );
  expect(runs).toBe(1);
  yield* awaited(reopened.harness.close(context));
});

describe("task scheduling", () => {
  it("fails the Harness on a failed reservation commit; reopening runs the task", () =>
    Effect.runPromise(failsHarnessFailed));
});

const failsHarnessInstead = Effect.gen(function* () {
  let runs = 0;
  const storage = new ControlledStorage();
  const failure = new Error("disk gone");
  const Throws = oneStep("test.failed-fault", () => {
    runs++;
    if (runs === 1) storage.failNextCommit(failure);
    return Promise.reject(new Error("boom"));
  });
  const { harness, root, reports } = yield* openRoot([Throws], { storage });
  const id = yield* awaited(start(root, Throws));
  harness.resume();
  expect(yield* awaited(harness.closed)).toEqual({ reason: "failed", error: failure });
  expect(runs).toBe(1);
  expect(reports).toEqual([failure]);
  yield* awaited(harness.close(context));

  const reopened = yield* openRoot([Throws], { storage: storage.reopen() });
  reopened.harness.resume();
  expect((yield* awaited(reopened.harness.waitForTask(id, context))).state.outcome).toEqual({
    status: "faulted",
    error: { message: "boom" },
  });
  expect(runs).toBe(2);
  yield* awaited(reopened.harness.close(context));
});

describe("task scheduling", () => {
  it("fails the Harness instead of running a task again when its fault write fails", () =>
    Effect.runPromise(failsHarnessInstead));
});

const waitsHarnessConversation = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const gates = new Map<TaskId, () => void>();
  const Gated = oneStep("test.gated", (task, runtime, ctx) =>
    runPromise(
      Effect.gen(function* () {
        const { promise, resolve } = Promise.withResolvers<void>();
        gates.set(task.id, resolve);
        yield* awaited(promise);
        yield* awaited(runtime.commit(() => completed(null), ctx));
      }),
    ),
  );
  const { harness, root } = yield* openRoot([Gated]);
  yield* awaited(harness.waitForIdle(context));
  const other = yield* awaited(
    harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  const foreground = yield* awaited(start(root, Gated));
  const background = yield* awaited(start(root, Gated, { background: true }));
  const elsewhere = yield* awaited(start(other, Gated));
  const cancelled = abortController();
  const cancelledWait = harness.waitForIdle(withSignal(cancelled.signal));
  cancelled.abort(new Error("stop waiting"));
  yield* awaited(expect(cancelledWait).rejects.toThrow("stop waiting"));
  const aborted = abortController();
  aborted.abort(new Error("already cancelled"));
  yield* awaited(
    expect(root.waitForIdle(withSignal(aborted.signal))).rejects.toThrow("already cancelled"),
  );
  harness.resume();
  yield* eventually(() => gates.size === 3);
  const rootIdle = root.waitForIdle(context);
  const harnessIdle = harness.waitForIdle(context);
  gates.get(foreground)!();
  yield* awaited(rootIdle);
  expect(yield* settled(harnessIdle)).toBe(false);
  gates.get(elsewhere)!();
  yield* awaited(harnessIdle);
  expect((yield* awaited(harness.getTask(background, context)))?.state.status).toBe("running");
  gates.get(background)!();
  yield* awaited(harness.waitForTask(background, context));
  yield* awaited(harness.close(context));
  yield* awaited(expect(harness.waitForIdle(context)).rejects.toThrow("closed"));
  yield* awaited(expect(root.waitForIdle(context)).rejects.toThrow("closed"));
});

describe("task scheduling", () => {
  it("waits for Harness and conversation idleness, counting blocked work and ignoring background tasks", () =>
    Effect.runPromise(waitsHarnessConversation));
});
