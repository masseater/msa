import { Effect } from "effect";

import ids from "./ids.ts";
import type replanApplyInternalTypes from "./replan-apply-internal.types.ts";
import type replanTypes from "./replan.types.ts";
import repoState from "./repo-state.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { repoStates } = repoState;
const { newId } = ids;

function collect(
  runtime: runtimeTypes.Runtime,
  memos: ReadonlyMap<string, string>,
): Effect.Effect<replanApplyInternalTypes.Handoff[]> {
  return Effect.gen(function* () {
    const database = runtime.database;
    const handoffs: replanApplyInternalTypes.Handoff[] = [];
    for (const [threadId, memo] of memos) {
      for (const assignment of store.assignmentsOfThread(database, threadId)) {
        const task = store.getTask(database, assignment.taskId);
        if (task === undefined) continue;
        const repo = yield* repoStates.read(task.cwd);
        handoffs.push({ memo, repo, taskId: task.id, threadId, title: task.title });
      }
    }
    return handoffs;
  });
}

function memoBlock(
  replanId: string,
  reason: string,
  handoff: replanApplyInternalTypes.Handoff,
): string {
  return [
    `replan ${replanId}: ${reason}`,
    repoStates.describe(handoff.repo),
    "",
    handoff.memo,
  ].join("\n");
}

function writeReport(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  threadId: string,
  content: string,
  now: number,
): void {
  store.insertReport(runtime.database, {
    content,
    createdAt: now,
    id: newId("rep"),
    role: "worker",
    status: "stopped",
    taskId,
    threadId,
  });
}

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

const replanApplyPart1 = {
  closeDropped,
  collect,
  memoBlock,
  newTask,
  writeReport,
};

export default replanApplyPart1;
