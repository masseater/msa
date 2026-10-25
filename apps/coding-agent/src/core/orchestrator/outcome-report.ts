import type outcomeTypes from "./outcome.types.ts";
import providerWaitModule from "./provider-wait.ts";
import runTimeNotice from "./run-time-notice.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import type workerTypes from "./worker.ts";

const { store } = storeModule;
const { runTimeSuffix } = runTimeNotice;
const { providerWaits } = providerWaitModule;

const REPORT_LIMIT = 4000;

function reportText(
  runtime: runtimeTypes.Runtime,
  assignments: readonly orchestratorTypesTypes.Assignment[],
  outcome: outcomeTypes.Outcome,
  status: workerTypes.ReportStatus,
  started: readonly string[],
): string {
  const titles = assignments.map((assignment) => {
    const task = store.getTask(runtime.database, assignment.taskId);
    return `${task?.title ?? assignment.taskId} (${assignment.role})`;
  });
  const content =
    outcome.content.length <= REPORT_LIMIT
      ? outcome.content
      : `${outcome.content.slice(0, REPORT_LIMIT)}\n[truncated]`;
  const first = assignments[0]?.taskId;
  const summary =
    outcome.limit === undefined || first === undefined
      ? `${titles.join(", ")} ${status}.${runTimeSuffix(runtime, assignments, outcome)}`
      : `${titles.join(", ")} waiting, not failed.${providerWaits.waitingLine(runtime, first)}`;
  return [
    summary,
    started.length > 0 ? `Started: ${started.join(", ")}.` : undefined,
    content === "" ? undefined : `<report>\n${content}\n</report>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const outcomeReport = { reportText };

export default outcomeReport;
