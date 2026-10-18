import type { DatabaseSync } from "node:sqlite";

import { scheduler } from "./scheduler.ts";
import { store } from "./store.ts";
import type {
  OrchestratorSnapshot,
  RoundView,
  TaskSnapshot,
  TaskView,
  WaitingReason,
} from "./types.ts";

function reasonFor(
  task: TaskView,
  byId: ReadonlyMap<string, TaskView>,
  free: number,
  runningKeys: readonly string[],
): WaitingReason {
  const unfinished = task.dependsOn.filter(
    (dependency) => byId.get(dependency)?.status !== "completed",
  );
  if (unfinished.length > 0) {
    const titles = unfinished.map((id) => byId.get(id)?.title ?? id);
    return { kind: "dependencies", detail: `waiting for ${titles.join(", ")}` };
  }
  if (task.condition !== null) return { kind: "condition", detail: `condition: ${task.condition}` };
  if (task.kind === "review" && task.dependsOn.length === 0) {
    return { kind: "review", detail: "round has no work to review yet" };
  }
  if (free <= 0) return { kind: "capacity", detail: "no free session slot" };
  if (scheduler.blockedByPaths(task, runningKeys)) {
    return { kind: "paths", detail: "paths are in use by a running task" };
  }
  return { kind: "scheduling", detail: "about to start" };
}

function taskViews(database: DatabaseSync, project: string): TaskView[] {
  const tasks = store.listTasks(database, project);
  const dependencies = store.listDependencyPairs(database, project);
  const assignments = store.listAssignments(database, project);
  const reports = store.listReports(database, project);
  return tasks.map((task) =>
    Object.assign(task, {
      dependsOn: dependencies
        .filter((pair) => pair.taskId === task.id)
        .map((pair) => pair.dependsOn)
        .toSorted(),
      dependents: dependencies
        .filter((pair) => pair.dependsOn === task.id)
        .map((pair) => pair.taskId)
        .toSorted(),
      assignments: assignments.filter((assignment) => assignment.taskId === task.id),
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
    title: round.title,
    reviewTaskId:
      tasks.find((task) => task.round === round.id && task.kind === "review")?.id ?? null,
    taskIds: tasks.filter((task) => task.round === round.id).map((task) => task.id),
  }));
}

function buildSnapshot(
  database: DatabaseSync,
  project: string,
  maxConcurrentSessions: number,
): OrchestratorSnapshot {
  const views = taskViews(database, project);
  const byId = new Map(views.map((task) => [task.id, task]));
  const running = views.filter((task) => task.status === "running");
  const sessions = store.listSessions(database, project);
  const free =
    maxConcurrentSessions - sessions.filter((session) => session.status === "running").length;
  const runningKeys = scheduler.occupiedKeys(running);
  const snapshots: TaskSnapshot[] = views.map((task) => ({
    ...task,
    waitingReason: task.status === "waiting" ? reasonFor(task, byId, free, runningKeys) : null,
  }));
  return {
    tasks: snapshots,
    sessions: store.sessionViews(database, project),
    rounds: roundViews(database, project, views),
    maxConcurrentSessions,
  };
}

export const snapshots = { taskViews, buildSnapshot };

export type {
  CreateTaskInput,
  NoteDelivery,
  OrchestratorSnapshot,
  ReportHit,
  SendNoteInput,
  TaskSnapshot,
  TaskView,
} from "./types.ts";
