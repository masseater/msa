import type DatabaseSync from "../platform/node/sqlite.ts";
import providerWaitModule from "./provider-wait.ts";
import replanStoreModule from "./replan-store.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { replanStore } = replanStoreModule;
const { providerWaits } = providerWaitModule;

function reasonFor(
  task: orchestratorTypesTypes.TaskView,
  byId: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
  free: number,
  wait: orchestratorTypesTypes.ProviderWait | undefined,
): orchestratorTypesTypes.WaitingReason {
  const unfinished = task.dependsOn.filter(
    (dependency) => byId.get(dependency)?.status !== "completed",
  );
  if (unfinished.length > 0) {
    const titles = unfinished.map((id) => byId.get(id)?.title ?? id);
    return { detail: `waiting for ${titles.join(", ")}`, kind: "dependencies" };
  }
  if (wait !== undefined) return { detail: providerWaits.waitingDetail(wait), kind: "provider" };
  if (task.condition !== null) return { detail: `condition: ${task.condition}`, kind: "condition" };
  if (task.kind === "review" && task.dependsOn.length === 0) {
    return { detail: "round has no work to review yet", kind: "review" };
  }
  if (free <= 0) return { detail: "no free thread slot", kind: "capacity" };
  return { detail: "about to start", kind: "scheduling" };
}

function waitingReason(
  task: orchestratorTypesTypes.TaskView,
  byId: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
  free: number,
  wait: orchestratorTypesTypes.ProviderWait | undefined,
): orchestratorTypesTypes.WaitingReason | null {
  if (task.status === "waiting") return reasonFor(task, byId, free, wait);
  return wait === undefined
    ? null
    : { detail: providerWaits.waitingDetail(wait), kind: "provider" };
}

function taskViews(database: DatabaseSync, project: string): orchestratorTypesTypes.TaskView[] {
  const tasks = store.listTasks(database, project);
  const dependencies = store.listDependencyPairs(database, project);
  const assignments = store.listAssignments(database, project);
  const reports = store.listReports(database, project);
  const pulls = new Map(
    store.listPullRequests(database, project).map((pull) => [pull.taskId, pull] as const),
  );
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
      pullRequest:
        pulls.get(task.id) ??
        (task.mergeInto === null ? null : (pulls.get(task.mergeInto) ?? null)),
      reports: reports.filter((report) => report.taskId === task.id),
    }),
  );
}

function roundViews(
  database: DatabaseSync,
  project: string,
  tasks: readonly orchestratorTypesTypes.TaskView[],
): orchestratorTypesTypes.RoundView[] {
  return store.listRoundIds(database, project).map((round) => ({
    id: round.id,
    reviewTaskId:
      tasks.find((task) => task.round === round.id && task.kind === "review")?.id ?? null,
    taskIds: tasks.filter((task) => task.round === round.id).map((task) => task.id),
    title: round.title,
  }));
}

function taskMarks(
  replan: orchestratorTypesTypes.ReplanView | undefined,
): Map<string, orchestratorTypesTypes.ReplanMark> {
  const marked = new Map<string, orchestratorTypesTypes.ReplanMark>();
  if (replan === undefined) return marked;
  const add = (ids: readonly string[], role: orchestratorTypesTypes.ReplanRole) => {
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

function handoffOf(task: orchestratorTypesTypes.TaskView): string | null {
  const stopped = task.reports.filter((report) => report.status === "stopped");
  return stopped.at(-1)?.content ?? null;
}

function buildSnapshot(
  database: DatabaseSync,
  project: string,
  maxConcurrentThreads: number,
): orchestratorTypesTypes.OrchestratorSnapshot {
  const views = taskViews(database, project);
  const byId = new Map(views.map((task) => [task.id, task]));
  const threads = store.listThreads(database, project);
  const free =
    maxConcurrentThreads - threads.filter((thread) => thread.status === "running").length;
  const replans = replanStore.listReplans(database, project, 10);
  const byTask = taskMarks(replans[0]);
  const waits = new Map(
    store.listProviderWaits(database, project).map((wait) => [wait.taskId, wait] as const),
  );
  const snapshots: orchestratorTypesTypes.TaskSnapshot[] = views.map((task) => ({
    ...task,
    handoff: handoffOf(task),
    replan: byTask.get(task.id) ?? null,
    waitingReason: waitingReason(task, byId, free, waits.get(task.id)),
  }));
  return {
    maxConcurrentThreads,
    replans,
    rounds: roundViews(database, project, views),
    tasks: snapshots,
    threads: store.threadViews(database, project),
  };
}

const snapshots = { buildSnapshot, taskViews };

const snapshot = {
  snapshots,
};

export default snapshot;
