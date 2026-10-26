import type orchestratorTypesTypes from "./types.types.ts";

const UNFINISHED: ReadonlySet<orchestratorTypesTypes.TaskStatus> = new Set([
  "waiting",
  "running",
  "needs-decision",
  "stopped",
  "failed",
]);

function titleKey(title: string): string {
  return title.trim().replaceAll(/\s+/gu, " ");
}

function unfinishedWithTitle(
  tasks: readonly orchestratorTypesTypes.Task[],
  title: string,
  closing: ReadonlySet<string> = new Set(),
): orchestratorTypesTypes.Task | undefined {
  const key = titleKey(title);
  return tasks.find(
    (task) =>
      task.kind === "work" &&
      UNFINISHED.has(task.status) &&
      !closing.has(task.id) &&
      titleKey(task.title) === key,
  );
}

function duplicateMessage(title: string, existing: orchestratorTypesTypes.Task): string {
  return `Task ${title} was not created: ${existing.id} (${existing.status}) already has this title and is unfinished. Message ${existing.id}, replace it with replan from, or drop it first.`;
}

const taskTitles = { duplicateMessage, titleKey, unfinishedWithTitle };

export default taskTitles;
