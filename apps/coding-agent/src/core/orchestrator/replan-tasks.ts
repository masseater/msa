import ids from "./ids.ts";
import type replanApplyInternalTypes from "./replan-apply-internal.types.ts";
import replanHandoffs from "./replan-handoffs.ts";
import replanSupport from "./replan-support.ts";
import type replanTypes from "./replan.types.ts";
import roundsModule from "./rounds.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import text from "./text.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { fail, unique } = replanSupport;
const { rounds } = roundsModule;
const { newId } = ids;
const { store } = storeModule;
const { writeReport } = replanHandoffs;
const { requireChecks, requireMergeTarget } = text;

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
    store.closeTask(database, task.id, replanId, now);
    writeReport(runtime, task.id, "replan", `dropped by replan ${replanId}: ${item.reason}`, now);
    dropped.push({ reason: item.reason, taskId: task.id, title: task.title });
  }
  for (const entry of prepared.entries) {
    for (const id of entry.from) {
      const task = store.getTask(database, id);
      if (task === undefined) continue;
      detachReview(runtime, task);
      store.closeTask(database, id, replanId, now);
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

function inheritedChecks(
  sources: readonly orchestratorTypesTypes.Task[],
): orchestratorTypesTypes.TaskCheck[] {
  const byKey = new Map(
    sources.flatMap((source) => source.checks).map((check) => [JSON.stringify(check), check]),
  );
  return [...byKey.values()];
}

function checksOf(
  input: orchestratorTypesTypes.ReplanTaskInput,
  sources: readonly orchestratorTypesTypes.Task[],
): orchestratorTypesTypes.TaskCheck[] {
  return input.checks === undefined
    ? inheritedChecks(sources)
    : requireChecks(`Task ${input.title}`, input.checks);
}

function cwdOf(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.ReplanTaskInput,
  sources: readonly orchestratorTypesTypes.Task[],
): string {
  return input.cwd ?? sources[0]?.cwd ?? runtime.options.cwd;
}

function roundFor(
  input: orchestratorTypesTypes.ReplanTaskInput,
  sources: readonly orchestratorTypesTypes.Task[],
): string {
  if (input.round !== undefined) return input.round;
  if (sources.length === 1) return sources[0]!.round;
  return "main";
}

function mergeTargetOf(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.ReplanTaskInput,
  sources: readonly orchestratorTypesTypes.Task[],
  replaced: ReadonlySet<string>,
): string | null {
  const find = (id: string) => store.getTask(runtime.database, id);
  const project = runtime.options.project;
  if (input.mergeInto !== undefined) return requireMergeTarget(input.mergeInto, project, find);
  const own = new Set(sources.map((source) => source.id));
  const source = sources.find((task) => task.mergeInto !== null && !own.has(task.mergeInto));
  const target = source?.mergeInto ?? null;
  if (source === undefined || target === null || replaced.has(target)) return target;
  try {
    return requireMergeTarget(target, project, find);
  } catch (error) {
    throw fail(
      `Task ${input.title} would inherit mergeInto ${target} from ${source.id}, but ${error instanceof Error ? error.message : String(error)} Pass mergeInto to choose another target.`,
    );
  }
}

function newTask(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.ReplanTaskInput,
  sources: readonly orchestratorTypesTypes.Task[],
  replaced: ReadonlySet<string>,
  now: number,
): orchestratorTypesTypes.Task {
  return {
    checks: checksOf(input, sources),
    condition: null,
    createdAt: now,
    currentState: input.currentState ?? inherited(sources, (source) => source.currentState),
    cwd: cwdOf(runtime, input, sources),
    goalState: input.goalState ?? inherited(sources, (source) => source.goalState),
    id: newId("t"),
    kind: "work",
    mergeInto: mergeTargetOf(runtime, input, sources, replaced),
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
  const replaced = new Set(prepared.entries.flatMap((entry) => entry.from));
  const created: orchestratorTypesTypes.ReplanCreated[] = [];
  const inheritors = new Map<string, string[]>();
  const byKey = new Map<string, string>();
  const pending: { taskId: string; refs: readonly string[]; explicit: boolean }[] = [];
  for (const entry of prepared.entries) {
    const sources = entry.from.flatMap((id) => prepared.views.get(id) ?? []);
    const task = newTask(runtime, entry.input, sources, replaced, now);
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
      if (!item.explicit && (closed.has(id) || store.getTask(database, id)?.status === "closed")) {
        continue;
      }
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

function successorsOf(
  prepared: Pick<replanTypes.Prepared, "views">,
  inheritors: ReadonlyMap<string, readonly string[]>,
  closed: ReadonlySet<string>,
  source: string,
): string[] {
  const heirs = inheritors.get(source);
  if (heirs !== undefined) return [...heirs];
  return (prepared.views.get(source)?.dependsOn ?? []).flatMap((id) =>
    closed.has(id) ? successorsOf(prepared, inheritors, closed, id) : [id],
  );
}

function redirectsOf(
  runtime: runtimeTypes.Runtime,
  prepared: Pick<replanTypes.Prepared, "sources" | "views">,
  inheritors: ReadonlyMap<string, readonly string[]>,
): replanTypes.Redirect[] {
  const database = runtime.database;
  const closed = new Set(prepared.sources);
  const redirects = new Map<string, { add: Set<string>; remove: Set<string> }>();
  for (const source of prepared.sources) {
    for (const dependentId of store.dependentsOf(database, source)) {
      const dependent = store.getTask(database, dependentId);
      if (dependent === undefined || closed.has(dependentId)) continue;
      if (dependent.status === "completed") continue;
      const redirect = redirects.get(dependentId) ?? { add: new Set(), remove: new Set() };
      redirects.set(dependentId, redirect);
      redirect.remove.add(source);
      if (dependent.kind === "review") continue;
      for (const heir of successorsOf(prepared, inheritors, closed, source)) {
        if (heir !== dependentId) redirect.add.add(heir);
      }
    }
  }
  return [...redirects].map(([taskId, redirect]) => ({
    add: [...redirect.add],
    remove: [...redirect.remove],
    taskId,
  }));
}

function redirectDependents(
  runtime: runtimeTypes.Runtime,
  prepared: replanTypes.Prepared,
  inheritors: ReadonlyMap<string, readonly string[]>,
): orchestratorTypesTypes.ReplanRewired[] {
  const database = runtime.database;
  const redirects = redirectsOf(runtime, prepared, inheritors);
  for (const redirect of redirects) {
    for (const source of redirect.remove) {
      store.removeDependency(database, redirect.taskId, source);
    }
    for (const heir of redirect.add) {
      store.addDependency(database, runtime.options.project, redirect.taskId, heir);
    }
  }
  return redirects.map((redirect) => ({
    dependsOn: store.dependenciesOf(database, redirect.taskId),
    taskId: redirect.taskId,
  }));
}

function keep(runtime: runtimeTypes.Runtime, prepared: replanTypes.Prepared, now: number): void {
  const database = runtime.database;
  for (const id of prepared.keep) {
    const task = store.getTask(database, id);
    if (task?.status === "stopped") store.setTaskStatus(database, id, "waiting", now);
  }
}

const replanTasks = {
  checksOf,
  closeDropped,
  createTasks,
  cwdOf,
  keep,
  redirectDependents,
  redirectsOf,
  rewire,
};

export default replanTasks;
