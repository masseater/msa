import { Effect, Result } from "effect";

import errors from "./errors.ts";
import type errorsTypes from "./errors.types.ts";
import ids from "./ids.ts";
import promptsModule from "./prompts.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import snapshot from "./snapshot.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import type workerTypes from "./worker.ts";

const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { snapshots } = snapshot;
const { prompts } = promptsModule;
const { newId } = ids;
const { orchestratorError } = errors;

interface ThreadPlan {
  threadId: string;
  prompt: string;
  model: string;
  thinkingLevel: orchestratorTypesTypes.Task["thinkingLevel"];
  notes: readonly orchestratorTypesTypes.Note[];
}

function notesFor(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  threadId: string,
): orchestratorTypesTypes.Note[] {
  return store.unreadNotes(runtime.database, runtime.options.project, taskId, threadId);
}

function markRead(
  runtime: runtimeTypes.Runtime,
  notes: readonly orchestratorTypesTypes.Note[],
  threadId: string,
  now: number,
): void {
  for (const note of notes) store.markNoteRead(runtime.database, note.id, threadId, now);
}

function dependencyViews(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.TaskView,
): orchestratorTypesTypes.TaskView[] {
  const byId = new Map(
    snapshots
      .taskViews(runtime.database, runtime.options.project)
      .map((view) => [view.id, view] as const),
  );
  return task.dependsOn.flatMap((id) => byId.get(id) ?? []);
}

function reviewerPrompt(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.TaskView,
  workerReport: string,
  notes: readonly orchestratorTypesTypes.Note[],
): string {
  if (task.kind === "review") {
    const byId = new Map(
      snapshots
        .taskViews(runtime.database, runtime.options.project)
        .map((view) => [view.id, view] as const),
    );
    const roundTasks = store
      .workTasksOfRound(runtime.database, runtime.options.project, task.round)
      .flatMap((work) => byId.get(work.id) ?? []);
    return prompts.roundReviewPrompt(task.round, roundTasks, notes);
  }
  return prompts.taskReviewerPrompt(task, workerReport, notes);
}

function promptFor(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.TaskView,
  role: orchestratorTypesTypes.ThreadRole,
  workerReport: string,
  notes: readonly orchestratorTypesTypes.Note[],
  extra: string,
): string {
  const base =
    role === "reviewer"
      ? reviewerPrompt(runtime, task, workerReport, notes)
      : prompts.workerPrompt(task, dependencyViews(runtime, task), notes);
  return [base, extra].filter(Boolean).join("\n\n");
}

function planThread(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
  workerReport: string,
  extra: string,
): ThreadPlan {
  const defaults = runtime.options.defaults();
  const threadId = newId("th");
  const view = snapshots
    .taskViews(runtime.database, runtime.options.project)
    .find((candidate) => candidate.id === task.id);
  if (view === undefined) throw new Error(`Unknown task: ${task.id}`);
  const notes = notesFor(runtime, task.id, threadId);
  const prompt = promptFor(runtime, view, role, workerReport, notes, extra);
  const model = role === "worker" ? (task.model ?? defaults.workerModel) : defaults.reviewModel;
  const thinkingLevel =
    role === "worker"
      ? (task.thinkingLevel ?? defaults.workerThinkingLevel)
      : defaults.reviewThinkingLevel;
  return { model, notes, prompt, thinkingLevel, threadId };
}

function failThread(
  runtime: runtimeTypes.Runtime,
  plan: ThreadPlan,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
  now: number,
  message: string,
): void {
  store.updateThread(runtime.database, plan.threadId, { status: "failed" }, now);
  store.setTaskStatus(runtime.database, task.id, "failed", now);
  runtime.publish();
  runtime.options.report(message, { role, started: [], status: "failed", taskId: task.id });
}

function insertRunningThread(
  runtime: runtimeTypes.Runtime,
  plan: ThreadPlan,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
  now: number,
): void {
  const database = runtime.database;
  store.insertThread(database, {
    createdAt: now,
    cwd: task.cwd,
    id: plan.threadId,
    model: plan.model,
    project: runtime.options.project,
    sessionFile: null,
    status: "running",
    thinkingLevel: plan.thinkingLevel ?? runtime.options.defaults().workerThinkingLevel,
    updatedAt: now,
  });
  store.insertAssignment(database, {
    createdAt: now,
    role,
    taskId: task.id,
    threadId: plan.threadId,
  });
  store.setTaskStatus(database, task.id, "running", now);
  markRead(runtime, plan.notes, plan.threadId, now);
}

function openWorker(
  runtime: runtimeTypes.Runtime,
  plan: ThreadPlan,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
  now: number,
): Effect.Effect<workerTypes.WorkerSession | undefined, errorsTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const thinkingLevel = plan.thinkingLevel ?? runtime.options.defaults().workerThinkingLevel;
    yield* Effect.sync(() => insertRunningThread(runtime, plan, task, role, now));
    const telemetry = runtime.telemetry.threadStarted(
      { model: plan.model, role, thinkingLevel, threadId: plan.threadId },
      task,
    );
    const created = yield* Effect.result(
      Effect.tryPromise({
        catch: orchestratorError,
        try: () =>
          runtime.options.createWorker({
            cwd: task.cwd,
            model: runtime.options.resolveModel(plan.model),
            telemetry,
            thinkingLevel,
          }),
      }),
    );
    if (Result.isFailure(created)) {
      yield* Effect.sync(() => failThread(runtime, plan, task, role, now, created.failure.message));
      return undefined;
    }
    return created.success;
  });
}

function launch(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  worker: workerTypes.WorkerSession,
  prompt: string,
  now: number,
): void {
  const run = runtime.nextRun();
  store.updateThread(runtime.database, threadId, { sessionFile: worker.sessionFile ?? null }, now);
  runtime.workers.set(threadId, worker);
  worker.subscribe(() => runtime.publish());
  runtime.runs.set(threadId, run);
  runtime.runStartedAt.set(threadId, performance.now());
  void worker.prompt(prompt).then(
    () => runtime.afterTurn(threadId, run, worker),
    (error: unknown) => runtime.settle(threadId, run, worker, error),
  );
}

function startTasks(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
  workerReport = "",
  extra = "",
): Effect.Effect<void, errorsTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const plan = planThread(runtime, task, role, workerReport, extra);
    const worker = yield* openWorker(runtime, plan, task, role, now);
    if (worker === undefined) return;
    yield* Effect.sync(() => launch(runtime, plan.threadId, worker, plan.prompt, now));
  });
}

const starting = { startTasks };

const start = {
  starting,
};

export default start;
