import { Deferred, Duration, Effect, Option, Result } from "effect";

import { outcomes } from "./outcome.ts";
import { type Runtime, nowMillis } from "./runtime.ts";
import { store } from "./store.ts";
import type { WorkerSession } from "./worker.ts";

export interface WrapUp {
  sent: boolean;
  memo: Deferred.Deferred<string, string>;
}

export interface WrapUpResume {
  turn: () => void;
  settle: (error: unknown) => void;
}

const TIMEOUT = Duration.minutes(15);

const PROMPT = [
  "<wrap-up>",
  "This session stops at the end of this turn, and other sessions continue the work from your memo.",
  "1. Commit and push every change you made. Leave nothing uncommitted or unpushed.",
  "2. Reply with only a handoff memo: the branch, the last commit, what is finished, what is left with the failing check or the remaining items, and the next steps in order. Say at the top when you could not commit or push.",
  "</wrap-up>",
].join("\n");

function pending(runtime: Runtime, sessionId: string): WrapUp | undefined {
  return runtime.wrapUps.get(sessionId);
}

function begin(
  runtime: Runtime,
  sessionId: string,
): Effect.Effect<Deferred.Deferred<string, string>> {
  return Effect.sync(() => {
    const memo = Deferred.makeUnsafe<string, string>();
    runtime.wrapUps.set(sessionId, { sent: false, memo });
    return memo;
  });
}

function fail(runtime: Runtime, sessionId: string, message: string): void {
  const wrapUp = pending(runtime, sessionId);
  if (wrapUp === undefined) return;
  runtime.wrapUps.delete(sessionId);
  Deferred.doneUnsafe(wrapUp.memo, Effect.fail(message));
}

function cancel(runtime: Runtime, sessionId: string): void {
  runtime.wrapUps.delete(sessionId);
}

function stopped(runtime: Runtime, sessionId: string, memo: string, now: number): void {
  const database = runtime.database;
  store.updateSession(database, sessionId, { status: "stopped" }, now);
  for (const assignment of store.assignmentsOfSession(database, sessionId)) {
    store.insertReport(database, {
      id: `rep-${assignment.sessionId}-${assignment.taskId}-wrap-up`,
      taskId: assignment.taskId,
      sessionId,
      role: assignment.role,
      status: "stopped",
      content: memo,
      createdAt: now,
    });
    store.setTaskStatus(database, assignment.taskId, "stopped", now);
  }
  runtime.runs.delete(sessionId);
  runtime.runStartedAt.delete(sessionId);
  runtime.publish();
}

function finish(runtime: Runtime, sessionId: string, worker: WorkerSession, now: number): void {
  const wrapUp = pending(runtime, sessionId);
  if (wrapUp === undefined) return;
  runtime.wrapUps.delete(sessionId);
  const outcome = outcomes.outcomeOf(worker, undefined);
  const memo = outcome.content.trim();
  stopped(runtime, sessionId, memo, now);
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
  runtime: Runtime,
  sessionId: string,
  worker: WorkerSession,
  resume: WrapUpResume,
): boolean {
  const wrapUp = pending(runtime, sessionId);
  if (wrapUp === undefined) return false;
  if (wrapUp.sent) {
    finish(runtime, sessionId, worker, Effect.runSync(nowMillis));
    return true;
  }
  wrapUp.sent = true;
  void worker.prompt(PROMPT).then(resume.turn, (error: unknown) => {
    fail(runtime, sessionId, `wrap-up failed: ${outcomes.errorText(error)}`);
    resume.settle(error);
  });
  return true;
}

function awaitMemo(
  runtime: Runtime,
  sessionId: string,
  memo: Deferred.Deferred<string, string>,
): Effect.Effect<string, string> {
  return Effect.gen(function* () {
    const awaited = yield* Effect.result(Deferred.await(memo).pipe(Effect.timeoutOption(TIMEOUT)));
    if (Result.isFailure(awaited)) return yield* Effect.fail(awaited.failure);
    if (Option.isNone(awaited.success)) {
      cancel(runtime, sessionId);
      return yield* Effect.fail("wrap-up timed out");
    }
    return awaited.success.value;
  });
}

export const wrapping = { begin, fail, cancel, takeOver, awaitMemo };
