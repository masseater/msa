import { defineDoc } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { currentTimeMillis } from "../src/clock.ts";
import effectSupport from "./effect-support.ts";
import harnessTasksSupport from "./harness-tasks-support.ts";
import sessionSupport from "./session-support.ts";
import type sessionSupportTypes from "./session-support.types.ts";
import taskSupport from "./task-support.ts";

const { abortController, awaited } = effectSupport;
const { oneStep, openRoot, start, withSignal } = harnessTasksSupport;
const { ControlledStorage, context } = sessionSupport;
const { completed, deferred, eventually, settled } = taskSupport;

const ordersRuntimeCommits = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  let before: Promise<void> | undefined;
  let after: Promise<void> | undefined;
  let held: ReturnType<sessionSupportTypes.ControlledStorage["holdCommits"]> | undefined;
  let harnessRef: Effect.Success<ReturnType<typeof openRoot>>["harness"] | undefined;
  const Detached = oneStep<string>("test.detached", (_task, runtime) => {
    held = storage.holdCommits();
    void harnessRef!.commit(
      (tx) => tx.appendEntry(runtime.conversationId, { kind: "blocker" }).then(() => undefined),
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
    result: "before",
    status: "completed",
  });
  yield* awaited(expect(after).rejects.toThrow(/invocation has ended|is terminal/u));
  yield* awaited(harness.close(context));
});

describe("task runtime", () => {
  it("orders runtime commits against the step: one queued before it lands, one after it rejects", () =>
    Effect.runPromise(ordersRuntimeCommits));
});

const LateNotes = defineDoc<{ text: string }>({
  initial: () => ({ text: "" }),
  kind: "test.late-watch",
  scope: "session",
  version: 1,
});

const stopsWatchAcquisition = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = new ControlledStorage();
  let watching: Promise<unknown> | undefined;
  let held: ReturnType<sessionSupportTypes.ControlledStorage["holdCommits"]> | undefined;
  let harnessRef: Effect.Success<ReturnType<typeof openRoot>>["harness"] | undefined;
  const Late = oneStep("test.late-watch", (_task, runtime) => {
    held = storage.holdCommits();
    void harnessRef!.commit(
      (tx) => tx.appendEntry(runtime.conversationId, { kind: "blocker" }).then(() => undefined),
      context,
    );
    void runPromise(
      Effect.sleep(1).pipe(
        Effect.andThen(
          Effect.sync(() => {
            watching = runtime.watchDoc(LateNotes, context).catch((error: unknown) => error);
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
        tx.doc(LateNotes).then((notes) => {
          notes.text = "x";
          return undefined;
        }),
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
        const sleepingInner = runtime.sleep(
          currentTimeMillis() + 60_000,
          withSignal(controller.signal),
        );
        controller.abort(new Error("stop sleeping"));
        yield* awaited(
          sleepingInner.catch((error: unknown) =>
            results.push(`cancelled:${(error as Error).message}`),
          ),
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
    reason: "test",
    status: "aborted",
  });
  expect(results).toEqual(["cancelled:stop sleeping", "signalled:AbortError"]);
  yield* awaited(harness.close(context));
});

describe("task runtime", () => {
  it("rejects a sleep when the invocation is signalled or the sleep's own context is cancelled", () =>
    Effect.runPromise(rejectsSleepInvocation));
});
