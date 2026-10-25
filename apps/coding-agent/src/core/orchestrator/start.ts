import { Effect, Result } from "effect";

import errors from "./errors.ts";
import ids from "./ids.ts";
import promptsModule from "./prompts.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import snapshot from "./snapshot.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import worktreeModule from "./worktree.ts";

const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { snapshots } = snapshot;
const { prompts } = promptsModule;
const { newId } = ids;
const { orchestratorError } = errors;
const { worktrees } = worktreeModule;

interface ThreadPlan {
  threadId: string;
  prompt: string;
  model: string;
  thinkingLevel: orchestratorTypesTypes.Task["thinkingLevel"];
  notes: readonly orchestratorTypesTypes.Note[];
  sessionFile?: string;
}

function viewsById(runtime: runtimeTypes.Runtime): Map<string, orchestratorTypesTypes.TaskView> {
  return new Map(
    snapshots
      .taskViews(runtime.database, runtime.options.project)
      .map((view) => [view.id, view] as const),
  );
}

function dependencyViews(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.TaskView,
): orchestratorTypesTypes.TaskView[] {
  const byId = viewsById(runtime);
  return task.dependsOn.flatMap((id) => byId.get(id) ?? []);
}

function reviewerPrompt(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.TaskView,
  workerReport: string,
  notes: readonly orchestratorTypesTypes.Note[],
): string {
  if (task.kind === "review") {
    const byId = viewsById(runtime);
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
  const threadId = newId("th");
  const view = viewsById(runtime).get(task.id);
  if (view === undefined) throw new Error(`Unknown task: ${task.id}`);
  const notes = store.unreadNotes(runtime.database, runtime.options.project, task.id, threadId);
  const prompt = promptFor(runtime, view, role, workerReport, notes, extra);
  return { ...threadModel(runtime, task, role), notes, prompt, threadId };
}

function threadModel(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
): Pick<ThreadPlan, "model" | "thinkingLevel"> {
  const defaults = runtime.options.defaults();
  return role === "worker"
    ? {
        model: task.model ?? defaults.workerModel,
        thinkingLevel: task.thinkingLevel ?? defaults.workerThinkingLevel,
      }
    : { model: defaults.reviewModel, thinkingLevel: defaults.reviewThinkingLevel };
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
    branch: null,
    createdAt: now,
    cwd: task.cwd,
    id: plan.threadId,
    model: plan.model,
    project: runtime.options.project,
    sessionFile: null,
    status: "running",
    targetBranch: null,
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
  for (const note of plan.notes) store.markNoteRead(database, note.id, plan.threadId, now);
}

interface OpenedWorker {
  worker: runtimeTypes.WorkerSession;
  workspace: orchestratorTypesTypes.Workspace;
}

function openWorkspace(
  runtime: runtimeTypes.Runtime,
  plan: ThreadPlan,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
  now: number,
): Effect.Effect<orchestratorTypesTypes.Workspace | undefined> {
  return Effect.gen(function* () {
    const prepared = yield* Effect.result(worktrees.prepare(runtime, task));
    if (Result.isFailure(prepared)) {
      yield* Effect.sync(() =>
        failThread(runtime, plan, task, role, now, prepared.failure.message),
      );
      return undefined;
    }
    const workspace = prepared.success;
    yield* Effect.sync(() =>
      store.updateThread(
        runtime.database,
        plan.threadId,
        { branch: workspace.branch, cwd: workspace.cwd, targetBranch: workspace.targetBranch },
        now,
      ),
    );
    return workspace;
  });
}

function openWorker(
  runtime: runtimeTypes.Runtime,
  plan: ThreadPlan,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
  now: number,
): Effect.Effect<OpenedWorker | undefined, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const thinkingLevel = plan.thinkingLevel ?? runtime.options.defaults().workerThinkingLevel;
    yield* Effect.sync(() => insertRunningThread(runtime, plan, task, role, now));
    const workspace = yield* openWorkspace(runtime, plan, task, role, now);
    if (workspace === undefined) return undefined;
    const telemetry = runtime.telemetry.threadStarted(
      { model: plan.model, role, thinkingLevel, threadId: plan.threadId },
      task,
    );
    const created = yield* Effect.result(
      Effect.tryPromise({
        catch: orchestratorError,
        try: () =>
          runtime.options.createWorker({
            cwd: workspace.cwd,
            model: runtime.options.resolveModel(plan.model),
            sessionFile: plan.sessionFile,
            telemetry,
            thinkingLevel,
          }),
      }),
    );
    if (Result.isFailure(created)) {
      yield* Effect.sync(() => failThread(runtime, plan, task, role, now, created.failure.message));
      return undefined;
    }
    return { worker: created.success, workspace };
  });
}

function noteActivity(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  worker: runtimeTypes.WorkerSession,
): void {
  const previous = runtime.activity.get(threadId);
  if (previous === undefined || previous.messages === worker.messages.length) return;
  runtime.activity.set(threadId, {
    at: Effect.runSync(nowMillis),
    messages: worker.messages.length,
  });
}

function launch(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  worker: runtimeTypes.WorkerSession,
  prompt: string,
  now: number,
): void {
  const run = runtime.nextRun();
  store.updateThread(runtime.database, threadId, { sessionFile: worker.sessionFile ?? null }, now);
  runtime.workers.set(threadId, worker);
  runtime.activity.set(threadId, { at: now, messages: worker.messages.length });
  worker.subscribe(() => {
    noteActivity(runtime, threadId, worker);
    runtime.publish();
  });
  runtime.runs.set(threadId, run);
  runtime.runStartedAt.set(threadId, performance.now());
  void worker.run.prompting.prompt(prompt).then(
    () => runtime.afterTurn(threadId, run, worker),
    (error: unknown) => runtime.settle(threadId, run, worker, error),
  );
}

function launchPlan(
  runtime: runtimeTypes.Runtime,
  plan: ThreadPlan,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const opened = yield* openWorker(runtime, plan, task, role, now);
    if (opened === undefined) return;
    const workspace =
      plan.sessionFile === undefined ? prompts.workspaceBlock(role, opened.workspace) : "";
    const prompt = [plan.prompt, workspace].filter(Boolean).join("\n\n");
    yield* Effect.sync(() => launch(runtime, plan.threadId, opened.worker, prompt, now));
  });
}

function startTasks(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
  workerReport = "",
  extra = "",
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.suspend(() =>
    launchPlan(runtime, planThread(runtime, task, role, workerReport, extra), task, role),
  );
}

const starting = { launchPlan, startTasks, threadModel };

const start = {
  starting,
};

export default start;
