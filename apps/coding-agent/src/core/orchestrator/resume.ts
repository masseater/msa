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
const { reopenWorker } = reopenModule;
const { markRead, notesFor } = threadPlanModule.threadPlans;

interface ResumeTarget {
  thread: orchestratorTypesTypes.Thread;
  role: orchestratorTypesTypes.ThreadRole;
  request: string;
}

function resumeTarget(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): ResumeTarget | undefined {
  const reports = store
    .reportsOfTask(runtime.database, task.id)
    .filter((report) => report.role !== "advisor" && report.role !== "triage");
  const asked = reports.at(-1);
  if (asked === undefined) return undefined;
  const reviewerAsked =
    asked.role === "reviewer" && (asked.verdict === null || asked.verdict === "undecided");
  const source = reviewerAsked ? asked : reports.findLast((report) => report.role === "worker");
  const thread =
    source === undefined ? undefined : store.getThread(runtime.database, source.threadId);
  if (thread === undefined) return undefined;
  return { request: asked.content, role: reviewerAsked ? "reviewer" : "worker", thread };
}

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
    const target = resumeTarget(runtime, task);
    if (target === undefined) {
      yield* startTasks(runtime, task, "worker", "", decision);
      return;
    }
    const { thread } = target;
    const notes = notesFor(runtime, task.id, thread.id);
    yield* Effect.sync(() => {
      store.updateThread(runtime.database, thread.id, { status: "running" }, now);
      store.setTaskStatus(runtime.database, task.id, "running", now);
      markRead(runtime, notes, thread.id, now);
    });
    const worker = yield* reopenWorker(runtime, task, thread, target.role, now);
    if (worker === undefined) return;
    const prompt = decisionPrompts.resumePrompt(target.request, decision, notes, from);
    yield* Effect.sync(() => launch(runtime, thread.id, worker, prompt, now));
  });
}

const resuming = { resume };

const resumeModule = { resuming };

export default resumeModule;
