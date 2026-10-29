import { Effect } from "effect";

import replanSupport from "./replan-support.ts";
import replanTasks from "./replan-tasks.ts";
import type replanTypes from "./replan.types.ts";
import runningDependencies from "./running-dependencies.ts";
import type runtimeTypes from "./runtime.types.ts";
import taskCwd from "./task-cwd.ts";
import taskTitles from "./task-titles.ts";
import text from "./text.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { fail, unique } = replanSupport;
const { requireChecks } = text;
const { duplicateMessage, titleKey, unfinishedWithTitle } = taskTitles;
const { checksOf, cwdOf, redirectsOf } = replanTasks;
const { requireCheckableCwd } = taskCwd;

function assertKnown(
  views: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
  id: string,
  label: string,
): void {
  if (!views.has(id)) throw fail(`Unknown task in ${label}: ${id}`);
}

function assertDisjoint(left: readonly string[], right: readonly string[], label: string): void {
  const shared = left.filter((id) => right.includes(id));
  if (shared.length > 0) throw fail(`${label}: ${shared.join(", ")}`);
}

function entryKeys(
  entries: readonly replanTypes.Entry[],
  views: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (entry.key === null) continue;
    if (keys.has(entry.key)) throw fail(`Duplicate key in tasks: ${entry.key}`);
    if (views.has(entry.key)) throw fail(`Key ${entry.key} is also a task id`);
    keys.add(entry.key);
  }
  return keys;
}

function resolveRefs(
  refs: readonly string[],
  keys: ReadonlySet<string>,
  views: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
  label: string,
): void {
  for (const ref of refs) {
    if (!keys.has(ref)) assertKnown(views, ref, label);
  }
}

function inheritedState(
  entry: replanTypes.Entry,
  views: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
  pick: (task: orchestratorTypesTypes.TaskView) => string,
): string {
  return entry.from
    .flatMap((id) => views.get(id) ?? [])
    .map(pick)
    .filter((value) => value.trim() !== "")
    .join("\n\n");
}

function validateEntries(
  runtime: runtimeTypes.Runtime,
  entries: readonly replanTypes.Entry[],
  views: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
): void {
  const keys = entryKeys(entries, views);
  for (const entry of entries) {
    if (entry.input.title.trim() === "") throw fail("Every task needs a title");
    for (const id of entry.from) assertKnown(views, id, "from");
    const states = {
      currentState: entry.input.currentState ?? inheritedState(entry, views, (t) => t.currentState),
      goalState: entry.input.goalState ?? inheritedState(entry, views, (t) => t.goalState),
    };
    if (states.currentState.trim() === "" || states.goalState.trim() === "") {
      throw fail(`Task ${entry.input.title} needs a current state and a goal state`);
    }
    if (entry.input.model !== undefined) runtime.options.resolveModel(entry.input.model);
    requireChecks(`Task ${entry.input.title}`, entry.input.checks);
    resolveRefs(entry.input.dependsOn ?? [], keys, views, "dependsOn");
  }
}

function validateCwds(
  runtime: runtimeTypes.Runtime,
  entries: readonly replanTypes.Entry[],
  views: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
): Effect.Effect<void> {
  return Effect.forEach(
    entries,
    (entry) => {
      const sources = entry.from.flatMap((id) => views.get(id) ?? []);
      return requireCheckableCwd(
        `Task ${entry.input.title}`,
        cwdOf(runtime, entry.input, sources),
        checksOf(entry.input, sources),
      );
    },
    { discard: true },
  );
}

function validateHandling(
  input: orchestratorTypesTypes.ReplanInput,
  entries: readonly replanTypes.Entry[],
  views: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
): void {
  const from = entries.flatMap((entry) => entry.from);
  const keep = unique(input.keep ?? []);
  const drop = (input.drop ?? []).map((item) => item.taskId);
  const rewire = (input.rewire ?? []).map((item) => item.taskId);
  for (const id of [...keep, ...drop, ...rewire]) assertKnown(views, id, "keep, drop, or rewire");
  assertDisjoint(keep, drop, "kept tasks are also dropped");
  assertDisjoint(keep, from, "kept tasks are also replaced");
  assertDisjoint(drop, from, "dropped tasks are also replaced");
  assertDisjoint(rewire, drop, "dropped tasks are also rewired");
  assertDisjoint(rewire, from, "replaced tasks are also rewired");
  if (new Set(drop).size !== drop.length) throw fail("A task is dropped twice");
  if (new Set(rewire).size !== rewire.length) throw fail("A task is rewired twice");
}

function validateClosed(
  input: orchestratorTypesTypes.ReplanInput,
  entries: readonly replanTypes.Entry[],
  views: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
): void {
  const closedEarlier = (id: string) => views.get(id)?.status === "closed";
  const handled = [
    ...entries.flatMap((entry) => entry.from),
    ...(input.keep ?? []),
    ...(input.drop ?? []).map((item) => item.taskId),
    ...(input.rewire ?? []).map((item) => item.taskId),
  ].filter(closedEarlier);
  if (handled.length > 0) {
    throw fail(`Already closed by an earlier replan: ${unique(handled).join(", ")}`);
  }
  const closing = new Set([
    ...entries.flatMap((entry) => entry.from),
    ...(input.drop ?? []).map((item) => item.taskId),
  ]);
  const refs = [
    ...entries.flatMap((entry) => entry.input.dependsOn ?? []),
    ...(input.rewire ?? []).flatMap((item) => item.dependsOn),
  ].filter((ref) => closing.has(ref) || closedEarlier(ref));
  if (refs.length > 0) {
    throw fail(
      `Closed tasks never complete, so nothing may depend on them: ${unique(refs).join(", ")}. Depend on the tasks that replace them.`,
    );
  }
}

function validateTitles(
  input: orchestratorTypesTypes.ReplanInput,
  entries: readonly replanTypes.Entry[],
  views: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
): void {
  const closing = new Set([
    ...entries.flatMap((entry) => entry.from),
    ...(input.drop ?? []).map((item) => item.taskId),
  ]);
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = titleKey(entry.input.title);
    if (seen.has(key)) throw fail(`Two tasks in this replan have the title ${entry.input.title}`);
    seen.add(key);
    const existing = unfinishedWithTitle([...views.values()], entry.input.title, closing);
    if (existing !== undefined) throw fail(duplicateMessage(entry.input.title, existing));
  }
}

function plannedInheritors(entries: readonly replanTypes.Entry[]): Map<string, string[]> {
  const inheritors = new Map<string, string[]>();
  for (const entry of entries) {
    for (const source of entry.from) {
      inheritors.set(source, [...(inheritors.get(source) ?? []), entry.key ?? entry.input.title]);
    }
  }
  return inheritors;
}

function validateRunningDependencies(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.ReplanInput,
  entries: readonly replanTypes.Entry[],
  views: ReadonlyMap<string, orchestratorTypesTypes.TaskView>,
): void {
  if (input.stop !== false) return;
  const rewired = (input.rewire ?? []).map((item) => {
    const current = views.get(item.taskId)?.dependsOn ?? [];
    const next = unique(item.dependsOn);
    return {
      add: next.filter((id) => !current.includes(id)),
      remove: current.filter((id) => !next.includes(id)),
      taskId: item.taskId,
    };
  });
  const sources = unique([
    ...entries.flatMap((entry) => entry.from),
    ...(input.drop ?? []).map((item) => item.taskId),
  ]);
  const redirected = redirectsOf(runtime, { sources, views }, plannedInheritors(entries));
  runningDependencies.guard(runtime, [...rewired, ...redirected]);
}

const replanValidate = {
  validateClosed,
  validateCwds,
  validateEntries,
  validateHandling,
  validateRunningDependencies,
  validateTitles,
};

export default replanValidate;
