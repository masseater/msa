import ids from "./ids.ts";
import type replanApplyInternalTypes from "./replan-apply-internal.types.ts";
import replanApplyPart1 from "./replan-apply-part1.ts";
import replanSupport from "./replan-support.ts";
import type replanTypes from "./replan.types.ts";
import roundsModule from "./rounds.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { rounds } = roundsModule;
const { fail, unique } = replanSupport;
const { newId } = ids;
const { memoBlock, newTask, writeReport } = replanApplyPart1;

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

function writeHandoffs(
  runtime: runtimeTypes.Runtime,
  prepared: replanTypes.Prepared,
  handoffs: readonly replanApplyInternalTypes.Handoff[],
  replanId: string,
  now: number,
  inheritors: ReadonlyMap<string, readonly string[]>,
): void {
  for (const handoff of handoffs) {
    const content = memoBlock(replanId, prepared.input.reason, handoff);
    writeReport(runtime, handoff.taskId, handoff.threadId, content, now);
    const targets = prepared.keep.includes(handoff.taskId)
      ? [handoff.taskId]
      : [...(inheritors.get(handoff.taskId) ?? [])];
    if (targets.length === 0) continue;
    for (const target of targets) writeReport(runtime, target, handoff.threadId, content, now);
    store.insertNote(runtime.database, {
      author: "replan",
      content,
      createdAt: now,
      id: newId("note"),
      project: runtime.options.project,
      round: null,
      taskIds: targets,
    });
  }
}

const replanApplyPart2 = {
  createTasks,
  keep,
  rewire,
  writeHandoffs,
};

export default replanApplyPart2;
