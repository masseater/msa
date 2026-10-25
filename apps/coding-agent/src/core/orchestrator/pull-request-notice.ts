import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";

const { store } = storeModule;

const ENDED = new Set(["failed", "stopped"]);

function openPullRequests(
  runtime: runtimeTypes.Runtime,
  taskIds: readonly string[],
): string | undefined {
  const lines = [...new Set(taskIds)].flatMap((taskId) => {
    const task = store.getTask(runtime.database, taskId);
    const pull = store.pullRequestOf(runtime.database, taskId);
    if (task === undefined || !ENDED.has(task.status) || pull?.state !== "OPEN") return [];
    return [
      `${taskId} is ${task.status} but still carries open pull request #${pull.number} (${pull.url}, branch ${pull.branch}). Rerun the task to carry it on, hand the pull request to a new task with replan from ${taskId}, or close it.`,
    ];
  });
  return lines.length === 0 ? undefined : lines.join("\n");
}

const pullRequestNotice = { openPullRequests };

export default pullRequestNotice;
