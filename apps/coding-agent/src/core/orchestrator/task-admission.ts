import { Effect } from "effect";

import conditionModule from "./condition.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import taskTitles from "./task-titles.ts";
import text from "./text.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { conditions } = conditionModule;
const { duplicateMessage, unfinishedWithTitle } = taskTitles;
const { requireChecks, requireMergeTarget, requireStates } = text;

const UNFINISHED_TASKS_REQUIRING_DEPENDENCIES = 3;

function requireDependenciesWhenBusy(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.CreateTaskInput,
): void {
  if ((input.dependsOn ?? []).length > 0 || input.mergeInto !== undefined) return;
  const unfinished = store
    .listTasks(runtime.database, runtime.options.project)
    .filter(
      (task) => task.kind === "work" && (task.status === "waiting" || task.status === "running"),
    );
  if (unfinished.length < UNFINISHED_TASKS_REQUIRING_DEPENDENCIES) return;
  throw new Error(
    `Task ${input.title} has no dependsOn while ${unfinished.length} tasks are unfinished (${unfinished
      .map((task) => task.id)
      .join(
        ", ",
      )}). With ${UNFINISHED_TASKS_REQUIRING_DEPENDENCIES} or more unfinished tasks, a new task must name what it waits for in dependsOn, or the task it merges into in mergeInto. If it must run before existing tasks, insert it into the DAG with replan instead.`,
  );
}

function requireNewTitle(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.CreateTaskInput,
): void {
  const existing = unfinishedWithTitle(
    store.listTasks(runtime.database, runtime.options.project),
    input.title,
  );
  if (existing !== undefined) throw new Error(duplicateMessage(input.title, existing));
}

function resolveRound(
  runtime: runtimeTypes.Runtime,
  input: orchestratorTypesTypes.CreateTaskInput,
): string {
  if (input.round !== undefined) return input.round;
  const dependencies = input.dependsOn ?? [];
  if (dependencies.length === 0) return "main";
  const dependencyRounds = new Set<string>();
  for (const id of dependencies) {
    const task = store.getTask(runtime.database, id);
    if (task === undefined) throw new Error(`Unknown task: ${id}`);
    dependencyRounds.add(task.round);
  }
  if (dependencyRounds.size !== 1) {
    throw new Error("Dependencies belong to different rounds; pass round explicitly.");
  }
  return [...dependencyRounds][0]!;
}

function admitTask(runtime: runtimeTypes.Runtime, input: orchestratorTypesTypes.CreateTaskInput) {
  return Effect.gen(function* () {
    const states = requireStates(`Task ${input.title}`, input.currentState, input.goalState);
    const checks = requireChecks(`Task ${input.title}`, input.checks);
    if (input.model !== undefined) runtime.options.resolveModel(input.model);
    requireNewTitle(runtime, input);
    requireDependenciesWhenBusy(runtime, input);
    if (input.condition !== undefined) {
      yield* conditions.requireValidCondition(input.title, input.condition);
    }
    const round = resolveRound(runtime, input);
    const mergeInto = requireMergeTarget(input.mergeInto, runtime.options.project, (id) =>
      store.getTask(runtime.database, id),
    );
    return { checks, mergeInto, round, states };
  });
}

const taskAdmission = { admitTask };

export default taskAdmission;
