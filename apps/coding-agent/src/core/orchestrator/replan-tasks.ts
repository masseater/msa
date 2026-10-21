import ids from "./ids.ts";
import type replanApplyInternalTypes from "./replan-apply-internal.types.ts";
import replanHandoffs from "./replan-handoffs.ts";
import replanSupport from "./replan-support.ts";
import type replanTypes from "./replan.types.ts";
import roundsModule from "./rounds.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { fail, unique } = replanSupport;
const { rounds } = roundsModule;
const { newId } = ids;
const { store } = storeModule;
const { writeReport } = replanHandoffs;

function detachReview(runtime: runtimeTypes.Runtime, task: orchestratorTypesTypes.Task): void {
  const review = store.reviewTaskOfRound(runtime.database, runtime.options.project, task.round);
  if (review !== undefined) store.removeDependency(runtime.database, review.id, task.id);
}

function closeDropped(
  runtime: runtimeTypes.Runtime,
  prepared: replanTypes.Prepared,
  replanId: string,
  now: number,
): orchestratorTypesTypes.ReplanDropped[] {
  const database = runtime.database;
  const dropped: orchestratorTypesTypes.ReplanDropped[] = [];
  for (const item of prepared.drop) {
    const task = store.getTask(database, item.taskId);
    if (task === undefined) continue;
    detachReview(runtime, task);
    store.setTaskStatus(database, task.id, "stopped", now);
    writeReport(runtime, task.id, "replan", `dropped by replan ${replanId}: ${item.reason}`, now);
    dropped.push({ reason: item.reason, taskId: task.id, title: task.title });
  }
  for (const entry of prepared.entries) {
    for (const id of entry.from) {
      const task = store.getTask(database, id);
      if (task === undefined) continue;
      detachReview(runtime, task);
      store.setTaskStatus(database, id, "stopped", now);
    }
  }
  return dropped;
}

function inherited(
  sources: readonly orchestratorTypesTypes.Task[],
  pick: (task: orchestratorTypesTypes.Task) => string,
): string {
  return sources
    .map(pick)
    .filter((value) => value.trim() !== "")
    .join("\n\n");
}

function roundFor(
  input: orchestratorTypesTypes.ReplanTaskInput,
  sources: readonly orchestratorTypesTypes.Task[],
): string {
  if (input.round !== undefined) return input.round;
  if (sources.length === 1) return sources[0]!.round;
  return "main";
}

function newTask(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.ReplanTaskInput,
  sources: readonly orchestratorTypesTypes.Task[],
  now: number,
): orchestratorTypesTypes.Task {
  return {
    condition: null,
    createdAt: now,
    currentState: input.currentState ?? inherited(sources, (source) => source.currentState),
    cwd: input.cwd ?? sources[0]?.cwd ?? runtime.options.cwd,
    goalState: input.goalState ?? inherited(sources, (source) => source.goalState),
    id: newId("t"),
    kind: "work",
    model: input.model ?? null,
    project: runtime.options.project,
    round: roundFor(input, sources),
    status: "waiting",
    thinkingLevel: input.thinkingLevel ?? null,
    title: input.title,
    updatedAt: now,
  };
}

function createTasks(
  runtime: runtimeTypes.Runtime,
  prepared: replanTypes.Prepared,
  now: number,
): replanApplyInternalTypes.Creation {
  const database = runtime.database;
  const project = runtime.options.project;
  const closed = new Set(prepared.sources);
  const created: orchestratorTypesTypes.ReplanCreated[] = [];
  const inheritors = new Map<string, string[]>();
  const byKey = new Map<string, string>();
  const pending: { taskId: string; refs: readonly string[]; explicit: boolean }[] = [];
  for (const entry of prepared.entries) {
    const sources = entry.from.flatMap((id) => prepared.views.get(id) ?? []);
    const task = newTask(runtime, entry.input, sources, now);
    store.insertTask(database, task);
    const review = rounds.ensureReview(runtime, task.round, now);
    rounds.attachReview(runtime, review, task.id, now);
    if (entry.key !== null) byKey.set(entry.key, task.id);
    created.push({ from: entry.from, taskId: task.id, title: task.title });
    for (const source of entry.from) {
      inheritors.set(source, [...(inheritors.get(source) ?? []), task.id]);
    }
    pending.push({
      explicit: entry.input.dependsOn !== undefined,
      refs: entry.input.dependsOn ?? sources.flatMap((source) => source.dependsOn),
      taskId: task.id,
    });
  }
  for (const item of pending) {
    for (const ref of unique(item.refs)) {
      const id = byKey.get(ref) ?? ref;
      if (!item.explicit && closed.has(id)) continue;
      if (item.explicit && closed.has(id)) {
        throw fail(`${item.taskId} cannot depend on ${id}, which this replan closes`);
      }
      store.addDependency(database, project, item.taskId, id);
    }
  }
  return { byKey, created, inheritors };
}

function rewire(
  runtime: runtimeTypes.Runtime,
  prepared: replanTypes.Prepared,
  byKey: ReadonlyMap<string, string>,
): orchestratorTypesTypes.ReplanRewired[] {
  const database = runtime.database;
  const rewired: orchestratorTypesTypes.ReplanRewired[] = [];
  for (const item of prepared.rewire) {
    const refs = unique(item.dependsOn.map((ref) => byKey.get(ref) ?? ref));
    store.clearDependencies(database, item.taskId);
    for (const dependency of refs) {
      store.addDependency(database, runtime.options.project, item.taskId, dependency);
    }
    rewired.push({ dependsOn: refs, taskId: item.taskId });
  }
  return rewired;
}

function keep(runtime: runtimeTypes.Runtime, prepared: replanTypes.Prepared, now: number): void {
  const database = runtime.database;
  for (const id of prepared.keep) {
    const task = store.getTask(database, id);
    if (task?.status === "stopped") store.setTaskStatus(database, id, "waiting", now);
  }
}

const replanTasks = { closeDropped, createTasks, keep, rewire };

export default replanTasks;
