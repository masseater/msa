import { Effect } from "effect";

import type decideTypes from "../decision/decide.types.ts";
import outcomeModule from "./outcome.ts";
import reviewVerdictModule from "./review-verdict.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import threadRun from "./thread-run.ts";
import type threadRunTypes from "./thread-run.types.ts";

const { store } = storeModule;
const { outcomes } = outcomeModule;
const { threadRuns } = threadRun;
const { reviewVerdicts } = reviewVerdictModule;

function conclude(
  thread: threadRunTypes.ThreadRun,
  decided: decideTypes.Decision | undefined,
  readBefore: ReadonlySet<string>,
): void {
  const { runtime, threadId, run, worker } = thread;
  if (decided === undefined || !threadRuns.current(thread)) return;
  if (runtime.wrapUps.has(threadId)) {
    runtime.afterTurn(threadId, run, worker);
    return;
  }
  if (!threadRuns.continueWithNotes(thread, readBefore))
    threadRuns.settle(thread, undefined, reviewVerdicts.verdictOf(decided));
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
    (decided) => conclude(thread, decided, readBefore),
    (error: unknown) => threadRuns.settle(thread, error),
  );
  return true;
}

const reviewJudge = { judge };

const reviewJudgeModule = { reviewJudge };

export default reviewJudgeModule;
