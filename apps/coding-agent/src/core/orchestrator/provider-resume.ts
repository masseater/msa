import { Effect } from "effect";

import ids from "./ids.ts";
import providerWaitModule from "./provider-wait.ts";
import type runtimeTypes from "./runtime.types.ts";
import start from "./start.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { newId } = ids;
const { providerWaits } = providerWaitModule;
const { starting } = start;
const { store } = storeModule;

function resumeTask(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  wait: orchestratorTypesTypes.ProviderWait,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  if (wait.sessionFile === null) return starting.startTasks(runtime, task, wait.role);
  const { database } = runtime;
  const threadId = newId("th");
  const seen = new Set(store.notesReadBy(database, wait.threadId).map((note) => note.id));
  const notes = store.unreadNotes(database, runtime.options.project, task.id, threadId);
  const plan = {
    ...starting.threadModel(runtime, task, wait.role),
    notes,
    prompt: providerWaits.resumePrompt(
      wait,
      notes.filter((note) => !seen.has(note.id)),
    ),
    sessionFile: wait.sessionFile,
    threadId,
  };
  return starting.launchPlan(runtime, plan, task, wait.role);
}

function resumeDue(
  runtime: runtimeTypes.Runtime,
  free: number,
  now: number,
): Effect.Effect<string[], runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const started: string[] = [];
    for (const wait of store.listProviderWaits(runtime.database, runtime.options.project)) {
      if (started.length >= free || wait.resumeAt > now) break;
      const task = store.getTask(runtime.database, wait.taskId);
      store.deleteProviderWait(runtime.database, wait.taskId);
      if (task?.status !== "waiting") continue;
      yield* resumeTask(runtime, task, wait);
      started.push(task.id);
    }
    return started;
  });
}

const providerResume = { resumeDue };

export default providerResume;
