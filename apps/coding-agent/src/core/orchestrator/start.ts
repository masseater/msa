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

function notesFor(runtime: Runtime, taskIds: readonly string[], sessionId: string): Note[] {
  const notes = taskIds.flatMap((taskId) =>
    store.unreadNotes(runtime.database, runtime.options.project, taskId, sessionId),
  );
  return [...new Map(notes.map((note) => [note.id, note])).values()];
}

function markRead(runtime: Runtime, notes: readonly Note[], sessionId: string, now: number): void {
  for (const note of notes) store.markNoteRead(runtime.database, note.id, sessionId, now);
}

function dependencyViews(
  tasks: readonly TaskView[],
  byId: ReadonlyMap<string, TaskView>,
): TaskView[] {
  const ids = [...new Set(tasks.flatMap((task) => task.dependsOn))];
  return ids.flatMap((id) => byId.get(id) ?? []);
}

function reviewerPrompt(
  runtime: Runtime,
  tasks: readonly TaskView[],
  workerReport: string,
  notes: readonly Note[],
): string {
  const first = tasks[0];
  if (first === undefined) return prompts.notesBlock(notes);
  if (first.kind === "review") {
    const views = snapshots.taskViews(runtime.database, runtime.options.project);
    const byId = new Map(views.map((view) => [view.id, view]));
    const roundTasks = store
      .workTasksOfRound(runtime.database, runtime.options.project, first.round)
      .flatMap((task) => byId.get(task.id) ?? []);
    return prompts.roundReviewPrompt(first.round, roundTasks, notes);
  }
  return prompts.taskReviewerPrompt(tasks, workerReport, notes);
}

function promptFor(
  runtime: Runtime,
  tasks: readonly TaskView[],
  role: SessionRole,
  workerReport: string,
  notes: readonly Note[],
  extra: string,
): string {
  const views = snapshots.taskViews(runtime.database, runtime.options.project);
  const byId = new Map(views.map((view) => [view.id, view]));
  const base =
    role === "reviewer"
      ? reviewerPrompt(runtime, tasks, workerReport, notes)
      : prompts.workerPrompt(tasks, dependencyViews(tasks, byId), notes);
  return [base, extra].filter(Boolean).join("\n\n");
}

function planSession(
  runtime: Runtime,
  tasks: readonly Task[],
  role: SessionRole,
  workerReport: string,
  extra: string,
): SessionPlan {
  const defaults = runtime.options.defaults();
  const first = tasks[0]!;
  const sessionId = newId("s");
  const views = snapshots.taskViews(runtime.database, runtime.options.project);
  const byId = new Map(views.map((view) => [view.id, view]));
  const promptTasks = tasks.flatMap((task) => byId.get(task.id) ?? []);
  const notes = notesFor(
    runtime,
    tasks.map((task) => task.id),
    sessionId,
  );
  const prompt = promptFor(runtime, promptTasks, role, workerReport, notes, extra);
  const model = role === "worker" ? (first.model ?? defaults.workerModel) : defaults.reviewModel;
  const thinkingLevel =
    role === "worker"
      ? (first.thinkingLevel ?? defaults.workerThinkingLevel)
      : defaults.reviewThinkingLevel;
  return { sessionId, prompt, model, thinkingLevel, notes };
}

function failSession(
  runtime: Runtime,
  plan: SessionPlan,
  tasks: readonly Task[],
  first: Task,
  role: SessionRole,
  now: number,
  message: string,
): void {
  store.updateSession(runtime.database, plan.sessionId, { status: "failed" }, now);
  for (const task of tasks) store.setTaskStatus(runtime.database, task.id, "failed", now);
  runtime.publish();
  runtime.options.report(message, { taskId: first.id, role, status: "failed", started: [] });
}

function insertRunningSession(
  runtime: Runtime,
  plan: SessionPlan,
  tasks: readonly Task[],
  first: Task,
  role: SessionRole,
  now: number,
): void {
  const database = runtime.database;
  store.insertSession(database, {
    id: plan.sessionId,
    project: runtime.options.project,
    model: plan.model,
    thinkingLevel: plan.thinkingLevel ?? runtime.options.defaults().workerThinkingLevel,
    cwd: first.cwd,
    status: "running",
    sessionFile: null,
    createdAt: now,
    updatedAt: now,
  });
  for (const task of tasks) {
    store.insertAssignment(database, {
      taskId: task.id,
      sessionId: plan.sessionId,
      role,
      createdAt: now,
    });
    store.setTaskStatus(database, task.id, "running", now);
  }
  markRead(runtime, plan.notes, plan.sessionId, now);
}

function openWorker(
  runtime: Runtime,
  plan: SessionPlan,
  tasks: readonly Task[],
  first: Task,
  role: SessionRole,
  now: number,
): Effect.Effect<WorkerSession | undefined, OrchestratorError> {
  return Effect.gen(function* () {
    yield* Effect.sync(() => insertRunningSession(runtime, plan, tasks, first, role, now));
    const created = yield* Effect.result(
      Effect.tryPromise({
        try: () =>
          runtime.options.createWorker({
            cwd: first.cwd,
            model: runtime.options.resolveModel(plan.model),
            thinkingLevel: plan.thinkingLevel ?? runtime.options.defaults().workerThinkingLevel,
          }),
        catch: orchestratorError,
      }),
    );
    if (Result.isFailure(created)) {
      yield* Effect.sync(() =>
        failSession(runtime, plan, tasks, first, role, now, created.failure.message),
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
  tasks: readonly Task[],
  role: SessionRole,
  workerReport = "",
  extra = "",
): Effect.Effect<void, OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const first = tasks[0];
    if (first === undefined) return;
    const plan = planSession(runtime, tasks, role, workerReport, extra);
    const worker = yield* openWorker(runtime, plan, tasks, first, role, now);
    if (worker === undefined) return;
    yield* Effect.sync(() => launch(runtime, plan.sessionId, worker, plan.prompt, now));
  });
}

export const starting = { startTasks };
