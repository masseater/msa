import { Effect } from "effect";

import outcomeModule from "./outcome.ts";
import pullRequestMergeModule from "./pull-request-merge.ts";
import reviewEvidence from "./review-evidence.ts";
import type reviewEvidenceTypes from "./review-evidence.types.ts";
import reviewVerdictModule from "./review-verdict.ts";
import type runtimeTypes from "./runtime.types.ts";
import threadRun from "./thread-run.ts";
import type threadRunTypes from "./thread-run.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { outcomes } = outcomeModule;
const { threadRuns } = threadRun;
const { reviewVerdicts } = reviewVerdictModule;
const { pullRequestMerge } = pullRequestMergeModule;

function mergeAndSettle(
  thread: threadRunTypes.ThreadRun,
  task: orchestratorTypesTypes.Task,
  verdict: runtimeTypes.ReviewVerdict,
): void {
  const merging = Effect.map(
    pullRequestMerge.afterReview(thread.runtime, task, () => threadRuns.current(thread)),
    (merge) => ({
      merge,
    }),
  );
  const { runtime, threadId, run, worker } = thread;
  threadRuns.launch(thread, merging, (merged) =>
    Effect.promise(() =>
      (merged === undefined || !threadRuns.current(thread)
        ? Promise.resolve(false)
        : runtime.settle(
            threadId,
            run,
            worker,
            undefined,
            merged.merge === undefined ? verdict : { ...verdict, merge: merged.merge },
          )
      ).then((settled) =>
        settled ? undefined : runtime.exclusive(pullRequestMerge.afterInterrupt(runtime, task)),
      ),
    ),
  );
}

type Recorded = Extract<reviewEvidenceTypes.Evidence, { kind: "recorded" }>;

type Decision = Awaited<ReturnType<runtimeTypes.OrchestratorOptions["decide"]>>;

const askedToRecord = new WeakSet<runtimeTypes.WorkerSession>();

function conclude(
  thread: threadRunTypes.ThreadRun,
  task: orchestratorTypesTypes.Task,
  judged: { decided: Decision; evidence: Recorded } | undefined,
  readBefore: ReadonlySet<string>,
): void {
  const { runtime, threadId, run, worker } = thread;
  if (judged === undefined || !threadRuns.current(thread)) return;
  if (runtime.wrapUps.has(threadId)) {
    runtime.afterTurn(threadId, run, worker);
    return;
  }
  if (threadRuns.continueWithNotes(thread, readBefore)) return;
  const { checklist, unchanged } = judged.evidence;
  const verdict = reviewVerdicts.verdictOf(judged.decided, { checklist, unchanged });
  if (verdict.result === "pass") mergeAndSettle(thread, task, verdict);
  else threadRuns.settle(thread, undefined, verdict);
}

function unrecorded(
  thread: threadRunTypes.ThreadRun,
  evidence: Exclude<reviewEvidenceTypes.Evidence, Recorded>,
): void {
  if (!askedToRecord.has(thread.worker)) {
    askedToRecord.add(thread.worker);
    threadRuns.continueWith(thread, evidence.prompt);
    return;
  }
  askedToRecord.delete(thread.worker);
  threadRuns.settle(thread, undefined, {
    checklist: evidence.checklist.text,
    reason: "the reviewer was asked to record every goal item and did not",
    result: "undecided",
    stuck: false,
  });
}

function decideRecorded(
  runtime: runtimeTypes.Runtime,
  evidence: Recorded,
): Effect.Effect<{ decided: Decision; evidence: Recorded }> {
  return Effect.map(
    Effect.promise(() =>
      runtime.options.decide(evidence.request).catch((error: unknown) => ({
        reason: outcomes.errorText(error),
        status: "undecided" as const,
      })),
    ),
    (decided) => ({ decided, evidence }),
  );
}

function judge(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  run: number,
  worker: runtimeTypes.WorkerSession,
): boolean {
  const thread = { run, runtime, threadId, worker };
  const task = reviewVerdicts.judgedTaskOfThread(runtime, threadId);
  const outcome = outcomes.outcomeOf(worker, undefined);
  if (task === undefined || outcome.status !== "completed") return false;
  const readBefore = threadRuns.readIds(thread);
  const judging = Effect.gen(function* () {
    const evidence = yield* reviewEvidence.gather(runtime, task, threadId, outcome.content);
    if (evidence.kind === "unrecorded") return evidence;
    askedToRecord.delete(worker);
    return yield* decideRecorded(runtime, evidence);
  });
  threadRuns.launch(thread, judging, (judged) =>
    Effect.sync(() =>
      judged !== undefined && "kind" in judged
        ? unrecorded(thread, judged)
        : conclude(thread, task, judged, readBefore),
    ),
  );
  return true;
}

const reviewJudge = { judge };

const reviewJudgeModule = { reviewJudge };

export default reviewJudgeModule;
