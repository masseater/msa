import idsModule from "./ids.ts";
import type outcomeTypes from "./outcome.types.ts";
import providerWaitModule from "./provider-wait.ts";
import reviewVerdictModule from "./review-verdict.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import triageOutcome from "./triage-outcome.ts";
import type triageOutcomeTypes from "./triage-outcome.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { reviewVerdicts } = reviewVerdictModule;
const { newId } = idsModule;
const { providerWaits } = providerWaitModule;

const { worse } = triageOutcome;

type ReportStatus = triageOutcomeTypes.ReportStatus;

type Applied = triageOutcomeTypes.Applied;

type Judged = {
  task: orchestratorTypesTypes.Task;
  result: ReturnType<typeof reviewVerdicts.apply>;
};

interface Ending {
  runtime: runtimeTypes.Runtime;
  outcome: outcomeTypes.Outcome;
  now: number;
  verdict: runtimeTypes.ReviewVerdict | undefined;
  asked: runtimeTypes.DecisionAsk | undefined;
  applied: Applied;
}

function endTask(ending: Ending, taskId: string): ReportStatus {
  const status = ending.outcome.status === "stopped" ? "stopped" : "failed";
  store.setTaskStatus(ending.runtime.database, taskId, status, ending.now);
  return status;
}

function judge(ending: Ending, assignment: orchestratorTypesTypes.Assignment): Judged | undefined {
  if (ending.outcome.status !== "completed" || ending.asked !== undefined) return undefined;
  const task = reviewVerdicts.judgedTask(ending.runtime, assignment);
  return task === undefined ? undefined : { result: reviewVerdicts.apply(ending.verdict), task };
}

function record(
  ending: Ending,
  assignment: orchestratorTypesTypes.Assignment,
  judged: Judged | undefined,
  triaged: string | undefined,
): void {
  const { outcome } = ending;
  if (judged !== undefined) ending.applied.lines.push(judged.result.line);
  const lead = triaged ?? ending.asked?.text ?? judged?.result.line;
  store.insertReport(ending.runtime.database, {
    content: lead === undefined ? outcome.content : `${lead}\n\n${outcome.content}`,
    createdAt: ending.now,
    id: newId(`rep-${assignment.threadId}-${assignment.role}`),
    role: assignment.role,
    status: outcome.status,
    taskId: assignment.taskId,
    threadId: assignment.threadId,
    verdict: judged?.result.result ?? null,
  });
}

function settleJudged(
  ending: Ending,
  judged: Judged,
  assignment: orchestratorTypesTypes.Assignment,
): void {
  const { applied } = ending;
  const { result, task } = judged;
  if (result.status === "needs-decision" && result.triage === true) {
    const request = `${result.line}\n\n${ending.outcome.content}`;
    const key = result.result === "pass" ? result.line : ending.outcome.content;
    triageOutcome.askTriage(applied, {
      key,
      request,
      taskId: task.id,
      threadId: assignment.threadId,
    });
    return;
  }
  applied.status = worse(applied.status, result.status);
  if (result.status === "sent-back") applied.sendBack.push({ prompt: result.prompt ?? "", task });
  else store.setTaskStatus(ending.runtime.database, task.id, result.status, ending.now);
}

function settleFinished(ending: Ending, assignment: orchestratorTypesTypes.Assignment): void {
  const database = ending.runtime.database;
  if (store.unfinishedDependencies(database, assignment.taskId).length > 0) {
    store.setTaskStatus(database, assignment.taskId, "waiting", ending.now);
    return;
  }
  if (assignment.role === "reviewer") {
    store.setTaskStatus(database, assignment.taskId, "completed", ending.now);
    return;
  }
  const task = store.getTask(database, assignment.taskId);
  if (task !== undefined) ending.applied.review.push(task);
}

function settleAssignment(ending: Ending, assignment: orchestratorTypesTypes.Assignment): void {
  const { applied, asked, runtime } = ending;
  const judged = judge(ending, assignment);
  const triaged =
    assignment.role === "triage"
      ? triageOutcome.settleTriage(runtime, applied, ending, assignment)
      : undefined;
  record(ending, assignment, judged, triaged);
  if (assignment.role === "triage") return;
  if (assignment.role === "advisor") {
    applied.status = worse(applied.status, "needs-decision");
  } else if (ending.outcome.status !== "completed") {
    applied.status = worse(applied.status, endTask(ending, assignment.taskId));
  } else if (asked?.triage === true) {
    triageOutcome.askTriage(applied, {
      key: asked.key,
      request: asked.text,
      taskId: assignment.taskId,
      threadId: assignment.threadId,
    });
  } else if (asked !== undefined) {
    applied.status = worse(applied.status, "needs-decision");
    store.setTaskStatus(runtime.database, assignment.taskId, "needs-decision", ending.now);
  } else if (judged !== undefined && judged.result.status !== "completed") {
    settleJudged(ending, judged, assignment);
  } else {
    settleFinished(ending, assignment);
  }
}

function applyOutcome(
  runtime: runtimeTypes.Runtime,
  assignments: readonly orchestratorTypesTypes.Assignment[],
  outcome: outcomeTypes.Outcome,
  now: number,
  verdict?: runtimeTypes.ReviewVerdict,
  decision?: runtimeTypes.DecisionAsk,
): Applied {
  const asked = outcome.status === "completed" ? decision : undefined;
  const applied: Applied = {
    lines: asked === undefined ? [] : [asked.text],
    resumes: [],
    review: [],
    sendBack: [],
    status: "completed",
    triage: [],
  };
  const ending: Ending = { applied, asked, now, outcome, runtime, verdict };
  for (const assignment of assignments) {
    if (outcome.limit !== undefined) {
      providerWaits.record(runtime, assignment, outcome.limit, now);
      applied.status = worse(applied.status, "waiting");
      continue;
    }
    store.clearProviderResumed(runtime.database, assignment.taskId);
    settleAssignment(ending, assignment);
  }
  return applied;
}

const outcomeApply = { applyOutcome };

export default outcomeApply;
