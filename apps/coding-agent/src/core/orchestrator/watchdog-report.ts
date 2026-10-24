import elapsedModule from "../../utils/elapsed.ts";
import pullRequestNotice from "./pull-request-notice.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type watchdogTypes from "./watchdog.types.ts";

const { store } = storeModule;
const { formatElapsed } = elapsedModule;

function taskLabel(runtime: runtimeTypes.Runtime, taskId: string): string {
  const task = store.getTask(runtime.database, taskId);
  return task === undefined ? taskId : `${task.title} (${taskId})`;
}

function joined(
  runtime: runtimeTypes.Runtime,
  taskIds: readonly string[],
  lines: readonly string[],
): string {
  const notice = pullRequestNotice.openPullRequests(runtime, taskIds);
  return [...lines, ...(notice === undefined ? [] : [notice])].join("\n\n");
}

function findingText(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  taskIds: readonly string[],
  status: string,
  content: string,
): string {
  const tasks = taskIds.map((taskId) => taskLabel(runtime, taskId));
  return joined(runtime, taskIds, [
    `${tasks.length > 0 ? tasks.join(", ") : `Thread ${threadId}`} ${status}.`,
    `${content} Rerun the task to continue.`,
  ]);
}

function threadlessText(runtime: runtimeTypes.Runtime, taskId: string, idleMs: number): string {
  return joined(
    runtime,
    [taskId],
    [
      `${taskLabel(runtime, taskId)} stopped.`,
      `Watchdog: the task was running with no running thread for ${formatElapsed(idleMs)}. Rerun the task to continue.`,
    ],
  );
}

function recoveredText(notices: readonly watchdogTypes.RecoveryNotice[]): string {
  const lines = notices.map(
    (notice) =>
      `- ${notice.title} (${notice.taskId}): running when ${notice.cause}, ${formatElapsed(notice.recoveredAt - notice.lastUpdate)} after its last update`,
  );
  return [
    `${notices.length === 1 ? "A task was" : `${notices.length} tasks were`} left running by an earlier orchestrator and are waiting again; the scheduler restarts them.`,
    lines.join("\n"),
  ].join("\n\n");
}

const watchdogReport = { findingText, recoveredText, threadlessText };

export default watchdogReport;
