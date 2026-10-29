import { Effect } from "effect";

import advisors from "./advisors.ts";
import decisionPrompts from "./decision-prompts.ts";
import reopenModule from "./reopen.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import startModule from "./start.ts";
import storeModule from "./store.ts";
import threadPlanModule from "./thread-plan.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { launch, startTasks } = startModule.starting;
const { reopenTarget, reopenWorker } = reopenModule;
const { markRead, notesFor } = threadPlanModule.threadPlans;

function resume(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  decision: string,
  from: "orchestrator" | "triage" = "orchestrator",
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    yield* advisors.stopRunning(runtime, task.id, now);
    yield* Effect.sync(() => store.clearProviderResumed(runtime.database, task.id));
    const target = yield* reopenTarget(runtime, task, decision, now);
    if (target === "held") return;
    if (target === undefined) {
      yield* startTasks(runtime, task, "worker", "", decision);
      return;
    }
    const { thread } = target;
    const worker = yield* reopenWorker(runtime, task, thread, target.role, now);
    if (worker === undefined) return;
    const notes = notesFor(runtime, task.id, thread.id);
    yield* Effect.sync(() => {
      store.updateThread(runtime.database, thread.id, { status: "running" }, now);
      store.setTaskStatus(runtime.database, task.id, "running", now);
      markRead(runtime, notes, thread.id, now);
    });
    const prompt = decisionPrompts.resumePrompt(target.request, decision, notes, from);
    yield* Effect.sync(() => launch(runtime, thread.id, worker, prompt, now));
  });
}

const resuming = { resume };

const resumeModule = { resuming };

export default resumeModule;
