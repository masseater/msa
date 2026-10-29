import { Effect } from "effect";

import outcomeApply from "./outcome-apply.ts";
import outcomeReport from "./outcome-report.ts";
import outcomeModule from "./outcome.ts";
import pullRequestNotice from "./pull-request-notice.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import settleFollowUps from "./settle-follow-ups.ts";
import storeModule from "./store.ts";
import wrapUp from "./wrap-up.ts";

const { nowMillis, releaseThread } = runtimeModule;
const { store } = storeModule;
const { outcomes } = outcomeModule;
const { wrapping } = wrapUp;

function reportContent(
  runtime: runtimeTypes.Runtime,
  assignments: readonly { taskId: string }[],
  lines: readonly string[],
  content: string,
): Effect.Effect<string> {
  return Effect.map(
    pullRequestNotice.openPullRequests(
      runtime,
      assignments.map((assignment) => assignment.taskId),
    ),
    (notice) => [...lines, ...(notice === undefined ? [] : [notice]), content].join("\n\n"),
  );
}

function forgetRun(runtime: runtimeTypes.Runtime, threadId: string): void {
  runtime.runs.delete(threadId);
  runtime.runStartedAt.delete(threadId);
  runtime.decisionRequests.delete(threadId);
  runtime.goalChecklists.delete(threadId);
  releaseThread(runtime, threadId);
}

function settleEffect(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  run: number,
  worker: runtimeTypes.WorkerSession,
  error: unknown,
  verdict?: runtimeTypes.ReviewVerdict,
  decision?: runtimeTypes.DecisionAsk,
): Effect.Effect<boolean, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    if (runtime.runs.get(threadId) !== run) return false;
    const now = yield* nowMillis;
    const thread = store.getThread(runtime.database, threadId);
    if (thread === undefined) return false;
    const assignments = store.assignmentsOfThread(runtime.database, threadId);
    forgetRun(runtime, threadId);
    const outcome = outcomes.outcomeOf(worker, error);
    if (outcome.status !== "completed") {
      wrapping.fail(runtime, threadId, `wrap-up failed: ${outcome.content}`);
    }
    const applied = yield* Effect.sync(() => {
      store.updateThread(runtime.database, threadId, { status: outcome.status }, now);
      return outcomeApply.applyOutcome(runtime, assignments, outcome, now, verdict, decision);
    });
    const started = yield* settleFollowUps.startFollowUps(runtime, {
      applied,
      assignments,
      cwd: thread.cwd,
      report: outcome.content,
    });
    const judged = {
      ...outcome,
      content: yield* reportContent(runtime, assignments, applied.lines, outcome.content),
    };
    yield* Effect.sync(() => {
      runtime.publish();
      const first = assignments[0];
      runtime.options.report(
        outcomeReport.reportText(runtime, assignments, judged, applied.status, started),
        {
          role: first?.role ?? "worker",
          started,
          status: applied.status,
          taskId: first?.taskId ?? threadId,
        },
      );
    });
    return true;
  });
}

function settle(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  run: number,
  worker: runtimeTypes.WorkerSession,
  error: unknown,
  verdict?: runtimeTypes.ReviewVerdict,
  decision?: runtimeTypes.DecisionAsk,
): Promise<boolean> {
  return runtime.exclusive(settleEffect(runtime, threadId, run, worker, error, verdict, decision));
}

const settling = { settle };

const settleModule = {
  settling,
};

export default settleModule;
