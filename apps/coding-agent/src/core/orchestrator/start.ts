import { Effect, Result } from "effect";

import { type OrchestratorError, orchestratorError } from "./errors.ts";
import { newId } from "./ids.ts";
import { prompts } from "./prompts.ts";
import { type Runtime, nowMillis } from "./runtime.ts";
import { snapshots } from "./snapshot.ts";
import { store } from "./store.ts";
import type { Note, SessionRole, Task, TaskView } from "./types.ts";
import type { WorkerSession } from "./worker.ts";

interface SessionPlan {
  sessionId: string;
  prompt: string;
  model: string;
  thinkingLevel: Task["thinkingLevel"];
  notes: readonly Note[];
}

function notesFor(runtime: Runtime, taskId: string, sessionId: string): Note[] {
  return store.unreadNotes(runtime.database, runtime.options.project, taskId, sessionId);
}

function markRead(runtime: Runtime, notes: readonly Note[], sessionId: string, now: number): void {
  for (const note of notes) store.markNoteRead(runtime.database, note.id, sessionId, now);
}

function dependencyViews(runtime: Runtime, task: TaskView): TaskView[] {
  const byId = new Map(
    snapshots
      .taskViews(runtime.database, runtime.options.project)
      .map((view) => [view.id, view] as const),
  );
  return task.dependsOn.flatMap((id) => byId.get(id) ?? []);
}

function reviewerPrompt(
  runtime: Runtime,
  task: TaskView,
  workerReport: string,
  notes: readonly Note[],
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
  runtime: Runtime,
  task: TaskView,
  role: SessionRole,
  workerReport: string,
  notes: readonly Note[],
  extra: string,
): string {
  const base =
    role === "reviewer"
      ? reviewerPrompt(runtime, task, workerReport, notes)
      : prompts.workerPrompt(task, dependencyViews(runtime, task), notes);
  return [base, extra].filter(Boolean).join("\n\n");
}

function planSession(
  runtime: Runtime,
  task: Task,
  role: SessionRole,
  workerReport: string,
  extra: string,
): SessionPlan {
  const defaults = runtime.options.defaults();
  const sessionId = newId("s");
  const view = snapshots
    .taskViews(runtime.database, runtime.options.project)
    .find((candidate) => candidate.id === task.id);
  if (view === undefined) throw new Error(`Unknown task: ${task.id}`);
  const notes = notesFor(runtime, task.id, sessionId);
  const prompt = promptFor(runtime, view, role, workerReport, notes, extra);
  const model = role === "worker" ? (task.model ?? defaults.workerModel) : defaults.reviewModel;
  const thinkingLevel =
    role === "worker"
      ? (task.thinkingLevel ?? defaults.workerThinkingLevel)
      : defaults.reviewThinkingLevel;
  return { sessionId, prompt, model, thinkingLevel, notes };
}

function failSession(
  runtime: Runtime,
  plan: SessionPlan,
  task: Task,
  role: SessionRole,
  now: number,
  message: string,
): void {
  store.updateSession(runtime.database, plan.sessionId, { status: "failed" }, now);
  store.setTaskStatus(runtime.database, task.id, "failed", now);
  runtime.publish();
  runtime.options.report(message, { taskId: task.id, role, status: "failed", started: [] });
}

function insertRunningSession(
  runtime: Runtime,
  plan: SessionPlan,
  task: Task,
  role: SessionRole,
  now: number,
): void {
  const database = runtime.database;
  store.insertSession(database, {
    id: plan.sessionId,
    project: runtime.options.project,
    model: plan.model,
    thinkingLevel: plan.thinkingLevel ?? runtime.options.defaults().workerThinkingLevel,
    cwd: task.cwd,
    status: "running",
    sessionFile: null,
    createdAt: now,
    updatedAt: now,
  });
  store.insertAssignment(database, {
    taskId: task.id,
    sessionId: plan.sessionId,
    role,
    createdAt: now,
  });
  store.setTaskStatus(database, task.id, "running", now);
  markRead(runtime, plan.notes, plan.sessionId, now);
}

function openWorker(
  runtime: Runtime,
  plan: SessionPlan,
  task: Task,
  role: SessionRole,
  now: number,
): Effect.Effect<WorkerSession | undefined, OrchestratorError> {
  return Effect.gen(function* () {
    yield* Effect.sync(() => insertRunningSession(runtime, plan, task, role, now));
    const created = yield* Effect.result(
      Effect.tryPromise({
        try: () =>
          runtime.options.createWorker({
            cwd: task.cwd,
            model: runtime.options.resolveModel(plan.model),
            thinkingLevel: plan.thinkingLevel ?? runtime.options.defaults().workerThinkingLevel,
          }),
        catch: orchestratorError,
      }),
    );
    if (Result.isFailure(created)) {
      yield* Effect.sync(() =>
        failSession(runtime, plan, task, role, now, created.failure.message),
      );
      return undefined;
    }
    return created.success;
  });
}

function launch(
  runtime: Runtime,
  sessionId: string,
  worker: WorkerSession,
  prompt: string,
  now: number,
): void {
  const run = runtime.nextRun();
  store.updateSession(
    runtime.database,
    sessionId,
    { sessionFile: worker.sessionFile ?? null },
    now,
  );
  runtime.workers.set(sessionId, worker);
  worker.subscribe(() => runtime.publish());
  runtime.runs.set(sessionId, run);
  runtime.runStartedAt.set(sessionId, performance.now());
  void worker.prompt(prompt).then(
    () => runtime.afterTurn(sessionId, run, worker),
    (error: unknown) => runtime.settle(sessionId, run, worker, error),
  );
}

function startTasks(
  runtime: Runtime,
  task: Task,
  role: SessionRole,
  workerReport = "",
  extra = "",
): Effect.Effect<void, OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const plan = planSession(runtime, task, role, workerReport, extra);
    const worker = yield* openWorker(runtime, plan, task, role, now);
    if (worker === undefined) return;
    yield* Effect.sync(() => launch(runtime, plan.sessionId, worker, plan.prompt, now));
  });
}

export const starting = { startTasks };
