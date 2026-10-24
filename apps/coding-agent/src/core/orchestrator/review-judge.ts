import { Effect } from "effect";

import type decideTypes from "../decision/decide.types.ts";
import outcomeModule from "./outcome.ts";
import pullRequestMergeModule from "./pull-request-merge.ts";
import reviewVerdictModule from "./review-verdict.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import threadRun from "./thread-run.ts";
import type threadRunTypes from "./thread-run.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { outcomes } = outcomeModule;
const { threadRuns } = threadRun;
const { reviewVerdicts } = reviewVerdictModule;
const { pullRequestMerge } = pullRequestMergeModule;

function mergeAndSettle(
  thread: threadRunTypes.ThreadRun,
  task: orchestratorTypesTypes.Task,
  verdict: runtimeTypes.ReviewVerdict,
): void {
  const merging = Effect.map(pullRequestMerge.afterReview(thread.runtime, task), (merge) => ({
    merge,
  }));
  void Effect.runPromise(threadRuns.whileCurrent(thread, merging)).then(
    (merged) =>
      merged === undefined || !threadRuns.current(thread)
        ? undefined
        : threadRuns.settle(
            thread,
            undefined,
            merged.merge === undefined ? verdict : { ...verdict, merge: merged.merge },
          ),
    (error: unknown) => threadRuns.settle(thread, error),
  );
}

function conclude(
  thread: threadRunTypes.ThreadRun,
  task: orchestratorTypesTypes.Task,
  decided: decideTypes.Decision | undefined,
  readBefore: ReadonlySet<string>,
): void {
  const { runtime, threadId, run, worker } = thread;
  if (decided === undefined || !threadRuns.current(thread)) return;
  if (runtime.wrapUps.has(threadId)) {
    runtime.afterTurn(threadId, run, worker);
    return;
  }
  if (threadRuns.continueWithNotes(thread, readBefore)) return;
  const verdict = reviewVerdicts.verdictOf(decided);
  if (verdict.result === "pass") mergeAndSettle(thread, task, verdict);
  else threadRuns.settle(thread, undefined, verdict);
}

function judge(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  run: number,
  worker: runtimeTypes.WorkerSession,
): boolean {
  const thread = { run, runtime, threadId, worker };
  const tasks = store
    .assignmentsOfThread(runtime.database, threadId)
    .flatMap((assignment) => reviewVerdicts.judgedTask(runtime, assignment) ?? []);
  const task = tasks[0];
  const outcome = outcomes.outcomeOf(worker, undefined);
  if (task === undefined || outcome.status !== "completed") return false;
  const readBefore = threadRuns.readIds(thread);
  const decision = Effect.promise(() =>
    runtime.options
      .decide(reviewVerdicts.verdictRequest(task, outcome.content))
      .catch((error: unknown) => ({
        reason: outcomes.errorText(error),
        status: "undecided" as const,
      })),
  );
  void Effect.runPromise(threadRuns.whileCurrent(thread, decision)).then(
    (decided) => conclude(thread, task, decided, readBefore),
    (error: unknown) => threadRuns.settle(thread, error),
  );
  return true;
}

const reviewJudge = { judge };

const reviewJudgeModule = { reviewJudge };

export default reviewJudgeModule;
