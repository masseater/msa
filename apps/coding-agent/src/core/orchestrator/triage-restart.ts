import { Effect } from "effect";

import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import startModule from "./start.ts";
import storeModule from "./store.ts";
import triageMemory from "./triage-memory.ts";
import triagePrompts from "./triage-prompts.ts";
import type triageTypes from "./triage.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { starting } = startModule;
const { nowMillis } = runtimeModule;

function launchTriage(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  ask: triageTypes.Ask,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const earlier = yield* triageMemory.earlier(runtime, ask);
    const threadId = yield* starting.startTasks(
      runtime,
      task,
      "triage",
      "",
      triagePrompts.requestBlocks(ask.request, earlier),
    );
    const now = yield* nowMillis;
    if (threadId !== undefined) store.saveTriageAsk(runtime.database, threadId, ask, now);
  });
}

function interrupted(
  runtime: runtimeTypes.Runtime,
  pending: ReturnType<typeof store.takePendingTriageAsks>[number],
): orchestratorTypesTypes.Task | undefined {
  const task = store.getTask(runtime.database, pending.ask.taskId);
  if (task?.status !== "waiting") return undefined;
  const later = store
    .assignmentsOfTask(runtime.database, task.id)
    .some(
      (assignment) =>
        assignment.threadId !== pending.triageThreadId && assignment.createdAt > pending.createdAt,
    );
  return later ? undefined : task;
}

function restartInterrupted(
  runtime: runtimeTypes.Runtime,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const pending = store.takePendingTriageAsks(runtime.database, runtime.options.project);
    for (const item of pending) {
      const task = interrupted(runtime, item);
      if (task !== undefined) yield* launchTriage(runtime, task, item.ask);
    }
    if (pending.length > 0) runtime.publish();
  });
}

const triageRestart = { launchTriage, restartInterrupted };

export default triageRestart;
