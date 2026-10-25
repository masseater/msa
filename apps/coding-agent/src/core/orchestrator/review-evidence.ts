import { Effect } from "effect";

import reviewChecklist from "./review-checklist.ts";
import type reviewEvidenceTypes from "./review-evidence.types.ts";
import reviewVerdictModule from "./review-verdict.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import workProgress from "./work-progress.ts";

const { store } = storeModule;
const { reviewVerdicts } = reviewVerdictModule;

type Evidence = reviewEvidenceTypes.Evidence;

function gather(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  threadId: string,
  report: string,
): Effect.Effect<Evidence> {
  return Effect.gen(function* () {
    const checklist = reviewChecklist.judge(task.goalState, runtime.goalChecklists.get(threadId));
    if (checklist.kind === "missing" || checklist.kind === "mismatch") {
      return {
        checklist,
        kind: "unrecorded",
        prompt: reviewChecklist.recordPrompt(task.goalState, checklist),
      } satisfies Evidence;
    }
    const progress = yield* workProgress.sinceLastReview(runtime, task.id, threadId);
    const request = reviewVerdicts.verdictRequest(task, report, {
      changes: progress.diff,
      previousReport: reviewVerdicts.previousFailedReview(runtime, task.id),
      pullRequestBody: store.pullRequestOf(runtime.database, task.mergeInto ?? task.id)?.verified
        ?.body,
    });
    return {
      checklist,
      kind: "recorded",
      request,
      unchanged: progress.unchanged,
    } satisfies Evidence;
  });
}

const reviewEvidence = { gather };

export default reviewEvidence;
