import type outcomeTypes from "./outcome.types.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import triageMemory from "./triage-memory.ts";
import type triageOutcomeTypes from "./triage-outcome.types.ts";
import triageText from "./triage-text.ts";
import type triageTypes from "./triage.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;

type ReportStatus = triageOutcomeTypes.ReportStatus;
type Applied = triageOutcomeTypes.Applied;

const SEVERITY: readonly ReportStatus[] = [
  "failed",
  "stopped",
  "needs-decision",
  "sent-back",
  "waiting",
  "completed",
];

function worse(left: ReportStatus, right: ReportStatus): ReportStatus {
  return SEVERITY.indexOf(left) <= SEVERITY.indexOf(right) ? left : right;
}

function askTriage(applied: Applied, ask: triageTypes.Ask): void {
  applied.triage.push(ask);
  applied.status = worse(applied.status, "waiting");
  applied.lines.push(
    "A triage thread checks first whether this needs a human; the task keeps running meanwhile, and you hear from it either way.",
  );
}

function lastRequest(runtime: runtimeTypes.Runtime, taskId: string): string {
  return (
    store
      .reportsOfTask(runtime.database, taskId)
      .findLast((report) => report.role !== "advisor" && report.role !== "triage")?.content ??
    "(the request is not recorded)"
  );
}

function settleTriage(
  runtime: runtimeTypes.Runtime,
  applied: Applied,
  ending: { outcome: outcomeTypes.Outcome; now: number },
  assignment: orchestratorTypesTypes.Assignment,
): string {
  const { threadId, taskId } = assignment;
  const conclusion =
    ending.outcome.status === "completed" ? runtime.triageConclusions.get(threadId) : undefined;
  const ask = store.takeTriageAsk(runtime.database, threadId);
  runtime.triageConclusions.delete(threadId);
  const task = store.getTask(runtime.database, taskId);
  if (conclusion?.conclusion === "decided" && task !== undefined) {
    applied.resumes.push({ ask, decision: triageText.decisionText(conclusion), task });
    applied.status = worse(applied.status, "sent-back");
    const line = triageText.decidedLine(conclusion);
    applied.lines.push(line);
    return line;
  }
  store.setTaskStatus(runtime.database, taskId, "needs-decision", ending.now);
  applied.status = worse(applied.status, "needs-decision");
  const repeated =
    conclusion?.conclusion === "repeat"
      ? triageMemory.decisionNumber(runtime, taskId, conclusion.repeats)
      : undefined;
  const line = triageText.escalationLine(
    conclusion,
    ask?.request ?? lastRequest(runtime, taskId),
    repeated,
  );
  applied.lines.push(line);
  return line;
}

const triageOutcome = { askTriage, settleTriage, worse };

export default triageOutcome;
