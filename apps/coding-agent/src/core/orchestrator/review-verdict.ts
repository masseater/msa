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
  result: orchestratorTypesTypes.ReviewVerdictResult;
  line: string;
  prompt?: string;
}

function passed(head: string, merge: runtimeTypes.MergeOutcome | undefined): ReviewResult {
  if (merge === undefined) return { line: head, result: "pass", status: "completed" };
  const line = `${head} ${merge.line}`;
  if (merge.kind === "merged") return { line, result: "pass", status: "completed" };
  if (merge.kind === "stopped") return { line, result: "pass", status: "stopped" };
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

function failsInARow(runtime: runtimeTypes.Runtime, taskId: string): number {
  const verdicts = store
    .reportsOfTask(runtime.database, taskId)
    .flatMap((report) =>
      report.role === "reviewer" && report.verdict !== null ? [report.verdict] : [],
    );
  const last = verdicts.findLastIndex((verdict) => verdict !== "fail");
  return verdicts.length - 1 - last;
}

function apply(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  verdict: Verdict | undefined,
): ReviewResult {
  const judged = verdict ?? { reason: "the review was not judged", result: "undecided" };
  const head = `Review verdict: ${judged.result} (${judged.reason}).`;
  if (judged.result === "pass") return passed(head, judged.merge);
  if (judged.result === "undecided") {
    return {
      line: `${head} The task is stopped, not completed: read the report and decide whether to rerun it with the findings.`,
      result: "undecided",
      status: "stopped",
    };
  }
  const round = (failsInARow(runtime, taskId) % (MAX_REJECTIONS + 1)) + 1;
  if (round > MAX_REJECTIONS) {
    return {
      line: `${head} The review still finds problems within the goal after ${MAX_REJECTIONS} rounds of fixes, so the task failed.`,
      result: "fail",
      status: "failed",
    };
  }
  return {
    line: `${head} Sent back to the worker to fix (round ${round} of ${MAX_REJECTIONS}).`,
    result: "fail",
    status: "sent-back",
  };
}

const reviewVerdicts = { apply, judgedTask, verdictOf, verdictRequest };

const reviewVerdict = { reviewVerdicts };

export default reviewVerdict;
