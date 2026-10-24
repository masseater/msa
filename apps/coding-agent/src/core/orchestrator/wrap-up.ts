import { Deferred, Duration, Effect, Option, Result } from "effect";

import outcomeModule from "./outcome.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type workerTypes from "./worker.ts";
import type wrapUpTypes from "./wrap-up.types.ts";

const { nowMillis, releaseThread } = runtimeModule;
const { store } = storeModule;
const { outcomes } = outcomeModule;

const TIMEOUT = Duration.minutes(15);

const PROMPT = [
  "<wrap-up>",
  "This thread stops at the end of this turn, and other threads continue the work from your memo.",
  "1. Commit and push every change you made. Leave nothing uncommitted or unpushed.",
  "2. Reply with only a handoff memo: the branch, the last commit, what is finished, what is left with the failing check or the remaining items, and the next steps in order. Say at the top when you could not commit or push.",
  "</wrap-up>",
].join("\n");

function pending(runtime: runtimeTypes.Runtime, threadId: string): wrapUpTypes.WrapUp | undefined {
  return runtime.wrapUps.get(threadId);
}

function begin(
  runtime: runtimeTypes.Runtime,
  threadId: string,
): Effect.Effect<Deferred.Deferred<string, string>> {
  return Effect.sync(() => {
    const memo = Deferred.makeUnsafe<string, string>();
    runtime.wrapUps.set(threadId, { memo, sent: false });
    return memo;
  });
}

function fail(runtime: runtimeTypes.Runtime, threadId: string, message: string): void {
  const wrapUp = pending(runtime, threadId);
  if (wrapUp === undefined) return;
  runtime.wrapUps.delete(threadId);
  Deferred.doneUnsafe(wrapUp.memo, Effect.fail(message));
}

function cancel(runtime: runtimeTypes.Runtime, threadId: string): void {
  runtime.wrapUps.delete(threadId);
}

function stopped(runtime: runtimeTypes.Runtime, threadId: string, memo: string, now: number): void {
  const database = runtime.database;
  store.updateThread(database, threadId, { status: "stopped" }, now);
  for (const assignment of store.assignmentsOfThread(database, threadId)) {
    store.insertReport(database, {
      content: memo,
      createdAt: now,
      id: `rep-${assignment.threadId}-${assignment.taskId}-wrap-up`,
      role: assignment.role,
      status: "stopped",
      taskId: assignment.taskId,
      threadId,
      verdict: null,
    });
    store.setTaskStatus(database, assignment.taskId, "stopped", now);
  }
  runtime.runs.delete(threadId);
  runtime.runStartedAt.delete(threadId);
  releaseThread(runtime, threadId);
  runtime.publish();
}

function finish(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  worker: workerTypes.WorkerSession,
  now: number,
): void {
  const wrapUp = pending(runtime, threadId);
  if (wrapUp === undefined) return;
  runtime.wrapUps.delete(threadId);
  const outcome = outcomes.outcomeOf(worker, undefined);
  const memo = outcome.content.trim();
  stopped(runtime, threadId, memo, now);
  if (outcome.status !== "completed") {
    Deferred.doneUnsafe(wrapUp.memo, Effect.fail(`wrap-up failed: ${memo}`));
    return;
  }
  if (memo === "") {
    Deferred.doneUnsafe(wrapUp.memo, Effect.fail("wrap-up returned no handoff memo"));
    return;
  }
  Deferred.doneUnsafe(wrapUp.memo, Effect.succeed(memo));
}

function takeOver(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  worker: workerTypes.WorkerSession,
  resume: wrapUpTypes.WrapUpResume,
): boolean {
  const wrapUp = pending(runtime, threadId);
  if (wrapUp === undefined) return false;
  if (wrapUp.sent) {
    finish(runtime, threadId, worker, Effect.runSync(nowMillis));
    return true;
  }
  wrapUp.sent = true;
  void worker.run.prompting.prompt(PROMPT).then(resume.turn, (error: unknown) => {
    fail(runtime, threadId, `wrap-up failed: ${outcomes.errorText(error)}`);
    resume.settle(error);
  });
  return true;
}

function awaitMemo(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  memo: Deferred.Deferred<string, string>,
): Effect.Effect<string, string> {
  return Effect.gen(function* () {
    const awaited = yield* Effect.result(Deferred.await(memo).pipe(Effect.timeoutOption(TIMEOUT)));
    if (Result.isFailure(awaited)) return yield* Effect.fail(awaited.failure);
    if (Option.isNone(awaited.success)) {
      cancel(runtime, threadId);
      return yield* Effect.fail("wrap-up timed out");
    }
    return awaited.success.value;
  });
}

const wrapping = { awaitMemo, begin, cancel, fail, takeOver };

const wrapUp = {
  wrapping,
};

export default wrapUp;
