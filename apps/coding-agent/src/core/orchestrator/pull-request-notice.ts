import { Effect } from "effect";

import pullRequestRefresh from "./pull-request-refresh.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";

const { store } = storeModule;

const ENDED = new Set(["failed", "stopped"]);

function openLine(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  write: runtimeTypes.Write | undefined,
): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined || !ENDED.has(task.status)) return [];
    if (store.pullRequestOf(runtime.database, taskId)?.state !== "OPEN") return [];
    const pull = yield* pullRequestRefresh.refreshEnd(runtime, taskId, write);
    if (pull?.state !== "OPEN") return [];
    return [
      `${taskId} is ${task.status} but still carries open pull request #${pull.number} (${pull.url}, branch ${pull.branch}). Rerun the task to carry it on, hand the pull request to a new task with replan from ${taskId}, or close it.`,
    ];
  });
}

function openPullRequests(
  runtime: runtimeTypes.Runtime,
  taskIds: readonly string[],
  write?: runtimeTypes.Write,
): Effect.Effect<string | undefined> {
  return Effect.map(
    Effect.forEach([...new Set(taskIds)], (taskId) => openLine(runtime, taskId, write)),
    (lines) => (lines.flat().length === 0 ? undefined : lines.flat().join("\n")),
  );
}

const pullRequestNotice = { openPullRequests };

export default pullRequestNotice;
