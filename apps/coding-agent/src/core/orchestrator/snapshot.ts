import type { DatabaseSync } from "node:sqlite";

import { replanStore } from "./replan-store.ts";
import { store } from "./store.ts";
import type {
  OrchestratorSnapshot,
  ReplanMark,
  ReplanRole,
  ReplanView,
  RoundView,
  TaskSnapshot,
  TaskView,
  WaitingReason,
} from "./types.ts";

function reasonFor(
  task: TaskView,
  byId: ReadonlyMap<string, TaskView>,
  free: number,
): WaitingReason {
  const unfinished = task.dependsOn.filter(
    (dependency) => byId.get(dependency)?.status !== "completed",
  );
  if (unfinished.length > 0) {
    const titles = unfinished.map((id) => byId.get(id)?.title ?? id);
    return { detail: `waiting for ${titles.join(", ")}`, kind: "dependencies" };
  }
  if (task.condition !== null) return { detail: `condition: ${task.condition}`, kind: "condition" };
  if (task.kind === "review" && task.dependsOn.length === 0) {
    return { detail: "round has no work to review yet", kind: "review" };
  }
  if (free <= 0) return { detail: "no free thread slot", kind: "capacity" };
  return { detail: "about to start", kind: "scheduling" };
}

function taskViews(database: DatabaseSync, project: string): TaskView[] {
  const tasks = store.listTasks(database, project);
  const dependencies = store.listDependencyPairs(database, project);
  const assignments = store.listAssignments(database, project);
  const reports = store.listReports(database, project);
  return tasks.map((task) =>
    Object.assign(task, {
      assignments: assignments.filter((assignment) => assignment.taskId === task.id),
      dependents: dependencies
        .filter((pair) => pair.dependsOn === task.id)
        .map((pair) => pair.taskId)
        .toSorted(),
      dependsOn: dependencies
        .filter((pair) => pair.taskId === task.id)
        .map((pair) => pair.dependsOn)
        .toSorted(),
      reports: reports.filter((report) => report.taskId === task.id),
    }),
  );
}

function roundViews(
  database: DatabaseSync,
  project: string,
  tasks: readonly TaskView[],
): RoundView[] {
  return store.listRoundIds(database, project).map((round) => ({
    id: round.id,
    reviewTaskId:
      tasks.find((task) => task.round === round.id && task.kind === "review")?.id ?? null,
    taskIds: tasks.filter((task) => task.round === round.id).map((task) => task.id),
    title: round.title,
  }));
}

function taskMarks(replan: ReplanView | undefined): Map<string, ReplanMark> {
  const marked = new Map<string, ReplanMark>();
  if (replan === undefined) return marked;
  const add = (ids: readonly string[], role: ReplanRole) => {
    for (const id of ids) marked.set(id, { id: replan.id, reason: replan.reason, role });
  };
  add(
    replan.stopped.map((item) => item.taskId),
    "stopped",
  );
  add(
    replan.created.map((item) => item.taskId),
    "created",
  );
  add(
    replan.dropped.map((item) => item.taskId),
    "dropped",
  );
  return marked;
}

function handoffOf(task: TaskView): string | null {
  const stopped = task.reports.filter((report) => report.status === "stopped");
  return stopped.at(-1)?.content ?? null;
}

function buildSnapshot(
  database: DatabaseSync,
  project: string,
  maxConcurrentThreads: number,
): OrchestratorSnapshot {
  const views = taskViews(database, project);
  const byId = new Map(views.map((task) => [task.id, task]));
  const threads = store.listThreads(database, project);
  const free =
    maxConcurrentThreads - threads.filter((thread) => thread.status === "running").length;
  const replans = replanStore.listReplans(database, project, 10);
  const byTask = taskMarks(replans[0]);
  const snapshots: TaskSnapshot[] = views.map((task) => ({
    ...task,
    handoff: handoffOf(task),
    replan: byTask.get(task.id) ?? null,
    waitingReason: task.status === "waiting" ? reasonFor(task, byId, free) : null,
  }));
  return {
    maxConcurrentThreads,
    replans,
    rounds: roundViews(database, project, views),
    tasks: snapshots,
    threads: store.threadViews(database, project),
  };
}

export const snapshots = { buildSnapshot, taskViews };

export type {
  CreateTaskInput,
  NoteDelivery,
  OrchestratorSnapshot,
  ReplanInput,
  ReplanResult,
  ReplanView,
  ReportHit,
  SendNoteInput,
  SetTaskDependsInput,
  SetTaskStateInput,
  TaskSnapshot,
  TaskView,
} from "./types.ts";
