import { Effect } from "effect";

import ids from "./ids.ts";
import providerWaitModule from "./provider-wait.ts";
import reviewHold from "./review-hold.ts";
import type runtimeTypes from "./runtime.types.ts";
import start from "./start.ts";
import storeModule from "./store.ts";
import triageRestart from "./triage-restart.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { newId } = ids;
const { providerWaits } = providerWaitModule;
const { starting } = start;
const { store } = storeModule;

function stillWaiting(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task | undefined,
  wait: orchestratorTypesTypes.ProviderWait,
): task is orchestratorTypesTypes.Task {
  if (task === undefined) return false;
  if (wait.role === "advisor") return task.status === "needs-decision";
  if (wait.role === "triage")
    return task.status === "running" && store.hasTriageAsk(runtime.database, wait.threadId);
  return task.status === "waiting";
}

function startOver(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  wait: orchestratorTypesTypes.ProviderWait,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  if (wait.role !== "triage") return Effect.asVoid(starting.startTasks(runtime, task, wait.role));
  const ask = store.takeTriageAsk(runtime.database, wait.threadId);
  return ask === undefined ? Effect.void : triageRestart.launchTriage(runtime, task, ask);
}

function resumeTask(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  wait: orchestratorTypesTypes.ProviderWait,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  const { database } = runtime;
  store.deleteProviderWait(database, wait.taskId);
  store.markProviderResumed(database, task.id, wait.reason);
  if (wait.sessionFile === null) return startOver(runtime, task, wait);
  const threadId = newId("th");
  if (wait.role === "triage") store.moveTriageAsk(database, wait.threadId, threadId);
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
  return Effect.asVoid(starting.launchPlan(runtime, plan, task, wait.role));
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
      if (!stillWaiting(runtime, task, wait)) {
        store.deleteProviderWait(runtime.database, wait.taskId);
        continue;
      }
      if (wait.role === "worker" && reviewHold.blockedByDependencies(runtime, task.id)) continue;
      if (wait.role === "reviewer") {
        const held = yield* reviewHold.holdReview(runtime, task, wait.threadId, now);
        if (held) {
          store.deleteProviderWait(runtime.database, wait.taskId);
          continue;
        }
      }
      yield* resumeTask(runtime, task, wait);
      started.push(task.id);
    }
    return started;
  });
}

const providerResume = { resumeDue };

export default providerResume;
