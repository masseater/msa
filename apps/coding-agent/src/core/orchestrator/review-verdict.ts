import type decideTypes from "../decision/decide.types.ts";
import type reviewChecklistTypes from "./review-checklist.types.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;

const VERDICT_THRESHOLD = 0.7;

type Verdict = runtimeTypes.ReviewVerdict;

type ReviewStatus = Extract<
  orchestratorTypesTypes.TaskStatus,
  "completed" | "needs-decision" | "stopped"
>;

interface ReviewResult {
  status: ReviewStatus | "sent-back";
  result: orchestratorTypesTypes.ReviewVerdictResult;
  line: string;
  prompt?: string;
}

function passed(head: string, merge: runtimeTypes.MergeOutcome | undefined): ReviewResult {
  if (merge === undefined) return { line: head, result: "pass", status: "completed" };
  const line = `${head} ${merge.line}`;
  if (merge.kind === "merged") return { line, result: "pass", status: "completed" };
  if (merge.kind === "stopped") return { line, result: "pass", status: "stopped" };
  if (merge.kind === "needs-decision") {
    return { line, result: "pass", status: "needs-decision" };
  }
  return { line, prompt: merge.prompt, result: "pass", status: "sent-back" };
}

function judgedTask(
  runtime: runtimeTypes.Runtime,
  assignment: orchestratorTypesTypes.Assignment,
): orchestratorTypesTypes.Task | undefined {
  if (assignment.role !== "reviewer") return undefined;
  const task = store.getTask(runtime.database, assignment.taskId);
  return task?.kind === "work" ? task : undefined;
}

function judgedTaskOfThread(
  runtime: runtimeTypes.Runtime,
  threadId: string,
): orchestratorTypesTypes.Task | undefined {
  return store
    .assignmentsOfThread(runtime.database, threadId)
    .flatMap((assignment) => judgedTask(runtime, assignment) ?? [])[0];
}

function previousFailedReview(runtime: runtimeTypes.Runtime, taskId: string): string | undefined {
  const judged = store
    .reportsOfTask(runtime.database, taskId)
    .findLast((report) => report.role === "reviewer" && report.verdict !== null);
  return judged?.verdict === "fail" ? judged.content : undefined;
}

const GOAL_QUESTION: decideTypes.DecisionQuestion = {
  criteria: {
    met: "Every item of the goal state is met by the work as the report and the pull request describe it.",
    unmet:
      "At least one item of the goal state is not met: the report or the pull request says it is left undone, partly done, deferred, out of scope, a known limitation, a follow-up, or something the work cannot do, or narrows the goal to what was done.",
  },
  instructions:
    "A reviewer checked work against the task's goal state and wrote the report; the pull request body is what would merge. Is every item of the goal state met, with nothing left as a known limitation, out of scope, or for later?",
  threshold: VERDICT_THRESHOLD,
  type: "choice",
};

const PROGRESS_QUESTION: decideTypes.DecisionQuestion = {
  criteria: {
    moving:
      "The report names a problem within the goal that the previous report did not name, or says a problem the previous report named is now fixed, or the changes since the previous review work on the problems it named.",
    stuck:
      "Every problem within the goal that the report names was already named in the previous report and is still not fixed, the report says nothing the previous report named is fixed now, and the changes since the previous review do not touch those problems.",
  },
  instructions:
    "The previous review sent the work back with the problems in the previous report, and the worker tried to fix them; changesSincePreviousReview is the diff of the working tree between the two reviews. Has the work moved since then, or does the new report repeat the same unfixed problems?",
  threshold: VERDICT_THRESHOLD,
  type: "choice",
};

interface VerdictContext {
  pullRequestBody: string | undefined;
  previousReport: string | undefined;
  changes: string;
}

function verdictRequest(
  task: orchestratorTypesTypes.Task,
  report: string,
  context: VerdictContext,
): decideTypes.DecideRequest {
  const { pullRequestBody, previousReport } = context;
  return {
    name: "review",
    questions: {
      goal: GOAL_QUESTION,
      ...(previousReport === undefined ? {} : { progress: PROGRESS_QUESTION }),
      verdict: {
        criteria: {
          fail: "The report names at least one problem within the task's goal that is not fixed yet, whatever its severity, including one it calls minor, says need not block the merge, leaves for a separate issue, or calls a known limitation or out of scope.",
          pass: "The report names no unfixed problem within the task's goal; every problem it names lies outside the goal.",
        },
        instructions:
          "A reviewer checked work against the task's goal state and wrote the report. Does a problem within the goal remain to be fixed?",
        threshold: VERDICT_THRESHOLD,
        type: "choice",
      },
    },
    state: {
      goalState: task.goalState,
      report,
      ...(pullRequestBody === undefined ? {} : { pullRequestBody }),
      ...(previousReport === undefined
        ? {}
        : { changesSincePreviousReview: context.changes, previousReport }),
    },
  };
}

function choiceOf(
  decision: Extract<decideTypes.Decision, { status: "decided" }>,
  id: string,
): { choice: string | undefined; odds: string } | undefined {
  const answer = new Map(Object.entries(decision.answers)).get(id);
  if (answer?.type !== "choice") return undefined;
  const odds = Object.entries(answer.probabilities)
    .map(([choice, probability]) => `${choice} ${probability.toFixed(2)}`)
    .join(", ");
  return { choice: answer.choice, odds };
}

interface Gates {
  checklist: reviewChecklistTypes.Judgement;
  unchanged: boolean;
}

function modelVerdict(decision: decideTypes.Decision, unchanged: boolean): Verdict {
  if (decision.status === "undecided")
    return { reason: decision.reason, result: "undecided", stuck: false };
  const verdict = choiceOf(decision, "verdict");
  const goal = choiceOf(decision, "goal");
  if (verdict === undefined || goal === undefined)
    return { reason: "no verdict answer", result: "undecided", stuck: false };
  const reason = `${decision.model}: verdict ${verdict.odds}; goal ${goal.odds}`;
  const stuck = unchanged && choiceOf(decision, "progress")?.choice === "stuck";
  if (verdict.choice === "fail" || goal.choice === "unmet")
    return { reason, result: "fail", stuck };
  if (verdict.choice === "pass" && goal.choice === "met")
    return { reason, result: "pass", stuck: false };
  return {
    reason: `${reason}; no answer reached the threshold`,
    result: "undecided",
    stuck: false,
  };
}

function verdictOf(decision: decideTypes.Decision, gates: Gates): Verdict {
  const judged = { ...modelVerdict(decision, gates.unchanged), checklist: gates.checklist.text };
  if (gates.checklist.kind === "met") return judged;
  const progress = decision.status === "decided" ? choiceOf(decision, "progress") : undefined;
  return {
    ...judged,
    reason: `${judged.reason}; the reviewer recorded a goal item as unmet`,
    result: "fail",
    stuck: gates.unchanged && progress?.choice === "stuck",
  };
}

function applyVerdict(verdict: Verdict | undefined): ReviewResult {
  const judged = verdict ?? {
    reason: "the review was not judged",
    result: "undecided",
    stuck: false,
  };
  const head = `Review verdict: ${judged.result} (${judged.reason}).`;
  if (judged.result === "pass") return passed(head, judged.merge);
  if (judged.result === "undecided") {
    return {
      line: `${head} The harness cannot tell whether the goal is met, so the task waits for a decision, not completed: read the report and the pull request, then answer with send_message; the reviewer continues with your answer.`,
      result: "undecided",
      status: "needs-decision",
    };
  }
  if (judged.stuck) {
    return {
      line: `${head} The review repeats the previous review's findings within the goal with none of them fixed, and the working tree holds the same files as at that review, so the work is not moving and the task waits for a decision instead of going back to the worker again: decide how to proceed and answer with send_message; the worker continues with your answer.`,
      result: "fail",
      status: "needs-decision",
    };
  }
  return {
    line: `${head} Sent back to the worker to fix.`,
    result: "fail",
    status: "sent-back",
  };
}

function apply(verdict: Verdict | undefined): ReviewResult {
  const result = applyVerdict(verdict);
  const checklist = verdict?.checklist;
  return checklist === undefined ? result : { ...result, line: `${result.line}\n${checklist}` };
}

const reviewVerdicts = {
  apply,
  judgedTask,
  judgedTaskOfThread,
  previousFailedReview,
  verdictOf,
  verdictRequest,
};

const reviewVerdict = { reviewVerdicts };

export default reviewVerdict;
