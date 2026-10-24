import type decideTypes from "../decision/decide.types.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import threadRun from "./thread-run.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { threadRuns } = threadRun;
const { MAX_REJECTIONS } = threadRuns;

const VERDICT_THRESHOLD = 0.7;

type Verdict = runtimeTypes.ReviewVerdict;

type ReviewStatus = Extract<orchestratorTypesTypes.TaskStatus, "completed" | "failed" | "stopped">;

interface ReviewResult {
  status: ReviewStatus | "sent-back";
  line: string;
}

function judgedTask(
  runtime: runtimeTypes.Runtime,
  assignment: orchestratorTypesTypes.Assignment,
): orchestratorTypesTypes.Task | undefined {
  if (assignment.role !== "reviewer") return undefined;
  const task = store.getTask(runtime.database, assignment.taskId);
  return task?.kind === "work" ? task : undefined;
}

function verdictRequest(
  task: orchestratorTypesTypes.Task,
  report: string,
): decideTypes.DecideRequest {
  return {
    name: "review",
    questions: {
      verdict: {
        criteria: {
          fail: "The report names at least one problem within the task's goal that is not fixed yet, whatever its severity, including one it calls minor, says need not block the merge, or leaves for a separate issue.",
          pass: "The report names no unfixed problem within the task's goal; every problem it names lies outside the goal.",
        },
        instructions:
          "A reviewer checked work against the task's goal state and wrote the report. Does a problem within the goal remain to be fixed?",
        threshold: VERDICT_THRESHOLD,
        type: "choice",
      },
    },
    state: { goalState: task.goalState, report },
  };
}

function verdictOf(decision: decideTypes.Decision): Verdict {
  if (decision.status === "undecided") return { reason: decision.reason, result: "undecided" };
  const answer = decision.answers["verdict"];
  if (answer?.type !== "choice") return { reason: "no verdict answer", result: "undecided" };
  const odds = Object.entries(answer.probabilities)
    .map(([choice, probability]) => `${choice} ${probability.toFixed(2)}`)
    .join(", ");
  if (answer.choice === "pass" || answer.choice === "fail")
    return { reason: `${decision.model}: ${odds}`, result: answer.choice };
  return {
    reason: `${decision.model}: no answer reached the threshold (${odds})`,
    result: "undecided",
  };
}

function apply(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  verdict: Verdict | undefined,
): ReviewResult {
  const judged = verdict ?? { reason: "the review was not judged", result: "undecided" };
  const head = `Review verdict: ${judged.result} (${judged.reason}).`;
  if (judged.result === "pass") {
    runtime.reviewRejections.delete(taskId);
    return { line: head, status: "completed" };
  }
  if (judged.result === "undecided") {
    return {
      line: `${head} The task is stopped, not completed: read the report and decide whether to rerun it with the findings.`,
      status: "stopped",
    };
  }
  const count = (runtime.reviewRejections.get(taskId) ?? 0) + 1;
  if (count > MAX_REJECTIONS) {
    runtime.reviewRejections.delete(taskId);
    return {
      line: `${head} The review still finds problems within the goal after ${MAX_REJECTIONS} rounds of fixes, so the task failed.`,
      status: "failed",
    };
  }
  runtime.reviewRejections.set(taskId, count);
  return {
    line: `${head} Sent back to the worker to fix (round ${count} of ${MAX_REJECTIONS}).`,
    status: "sent-back",
  };
}

function rejectionPrompt(report: string): string {
  return [
    "<review-failed>",
    "A reviewer checked your work and found problems within the task's goal, so the task is not complete. Fix every finding within the goal in the same branch and pull request, whatever its severity; a new review follows when you end your turn.",
    "<review-report>",
    report,
    "</review-report>",
    "</review-failed>",
  ].join("\n");
}

const reviewVerdicts = { apply, judgedTask, rejectionPrompt, verdictOf, verdictRequest };

const reviewVerdict = { reviewVerdicts };

export default reviewVerdict;
