import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import ControlledStorage from "./controlled-storage.ts";
import effectSupport from "./effect-support.ts";
import harnessTasksSupport from "./harness-tasks-support.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { abortController, awaited } = effectSupport;
const { oneStep, openRoot, start, withSignal } = harnessTasksSupport;
const { context } = sessionSupport;
const { completed, eventually, settled } = taskSupport;

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
  expect(end).toEqual({ error: failure, reason: "failed" });
  expect(reports).toEqual([failure]);
  yield* awaited(expect(waiting).rejects.toMatchObject({ cause: failure, name: "SessionFailed" }));
  yield* awaited(
    expect(harness.getTask(id, context)).rejects.toMatchObject({
      cause: failure,
      name: "SessionFailed",
    }),
  );
  yield* awaited(
    expect(root.submit({ content: "x", type: "input" }, context)).rejects.toMatchObject({
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
  expect(yield* awaited(harness.closed)).toEqual({ error: failure, reason: "failed" });
  expect(runs).toBe(1);
  expect(reports).toEqual([failure]);
  yield* awaited(harness.close(context));

  const reopened = yield* openRoot([Throws], { storage: storage.reopen() });
  reopened.harness.resume();
  expect((yield* awaited(reopened.harness.waitForTask(id, context))).state.outcome).toEqual({
    error: { message: "boom" },
    status: "faulted",
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

  const gates = new Map<durableTypes.TaskId, () => void>();
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
