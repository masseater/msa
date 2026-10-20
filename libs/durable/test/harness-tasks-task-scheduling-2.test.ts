import type { Context } from "@msa/chord";
import { type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import effectSupport from "./effect-support.ts";
import harnessTasksSupport from "./harness-tasks-support.ts";
import type harnessTasksSupportTypes from "./harness-tasks-support.types.ts";
import sessionSupport from "./session-support.ts";
import taskSupport from "./task-support.ts";

const { awaited } = effectSupport;
const { gated, oneStep, openRoot, start } = harnessTasksSupport;
const { context } = sessionSupport;
const { aborted, deferred, eventually } = taskSupport;

const signalsJoinsRun = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const reached = deferred();
  let runEnded = false;
  const Signalled = oneStep("test.signalled", (_task, runtime) =>
    runPromise(
      Effect.gen(function* () {
        reached.resolve();
        return yield* Effect.suspend(() => awaited(aborted(runtime.signal))).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              runEnded = true;
            }),
          ),
        );
      }),
    ),
  );
  const { harness, root } = yield* openRoot([Signalled]);
  const id = yield* awaited(start(root, Signalled));
  harness.resume();
  yield* awaited(reached.promise);
  expect(yield* awaited(harness.abortTask(id, context))).toBe("marked");
  expect(runEnded).toBe(true);
  expect(yield* awaited(harness.abortTask(id, context))).toBe("marked");
  expect((yield* awaited(harness.waitForTask(id, context))).state.outcome).toEqual({
    reason: "test",
    status: "aborted",
  });
  yield* awaited(harness.close(context));
});

describe("task abort", () => {
  it("signals and joins the run before returning, then runs the abort handler", () =>
    Effect.runPromise(signalsJoinsRun));
});

const abortsWaitingWorkStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const gate = deferred();
  const First = gated("test.dependency", gate.promise);
  let first: TaskId | undefined;
  const wait = (
    _task: unknown,
    runtime: harnessTasksSupportTypes.StepRuntime<null>,
    ctx: Context,
  ): Promise<void> =>
    runPromise(
      Effect.gen(function* () {
        const checkpoint = { phase: "run" } as const;
        yield* awaited(
          runtime.commit(
            () => ({ checkpoint, on: [first!], policy: "allSettled", status: "waiting" }),
            ctx,
          ),
        );
      }),
    );
  const Lazy = oneStep("test.lazy-abort", wait, () => Promise.resolve());
  const Throwing = oneStep("test.throwing-abort", wait, () =>
    Promise.reject(new Error("abort failed")),
  );
  const { harness, root } = yield* openRoot([First, Lazy, Throwing]);
  first = yield* awaited(start(root, First));
  const lazy = yield* awaited(start(root, Lazy));
  const throwing = yield* awaited(start(root, Throwing));
  harness.resume();
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(harness.getTask(throwing, context)))?.state.status === "waiting";
      }),
    ),
  );
  yield* eventually(() =>
    runPromise(
      Effect.gen(function* () {
        return (yield* awaited(harness.getTask(lazy, context)))?.state.status === "waiting";
      }),
    ),
  );
  yield* awaited(harness.abortTask(lazy, context));
  yield* awaited(harness.abortTask(throwing, context));
  return { first, gate, harness, lazy, throwing };
});

const abortsWaitingWork = Effect.gen(function* () {
  const { gate, first, harness, lazy, throwing } = yield* abortsWaitingWorkStep1;
  expect((yield* awaited(harness.waitForTask(lazy, context))).state.outcome).toEqual({
    error: { message: `Abort handler of task ${lazy} returned without a terminal outcome` },
    status: "faulted",
  });
  expect((yield* awaited(harness.waitForTask(throwing, context))).state.outcome).toEqual({
    error: { message: "abort failed" },
    status: "faulted",
  });
  expect((yield* awaited(harness.getTask(first, context)))?.state.status).toBe("running");
  gate.resolve();
  yield* awaited(harness.waitForTask(first, context));
  yield* awaited(harness.close(context));
});

describe("task abort", () => {
  it("aborts waiting work before its wait ends and faults abort handlers that throw or settle nothing", () =>
    Effect.runPromise(abortsWaitingWork));
});
