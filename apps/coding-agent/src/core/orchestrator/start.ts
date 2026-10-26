import { Effect, Result } from "effect";

import errors from "./errors.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import threadPlanModule from "./thread-plan.ts";
import threadTools from "./thread-tools.ts";
import threadWorkspace from "./thread-workspace.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { closedTaskMessage, orchestratorError } = errors;
const { toolsFor } = threadTools;
const { markRead, planThread, threadModel } = threadPlanModule.threadPlans;

type ThreadPlan = ReturnType<typeof planThread>;

function failThread(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
  now: number,
  message: string,
): void {
  store.updateThread(runtime.database, threadId, { status: "failed" }, now);
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
  if (role !== "advisor") store.setTaskStatus(database, task.id, "running", now);
  markRead(runtime, plan.notes, plan.threadId, now);
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
    const prepared = yield* Effect.result(
      threadWorkspace.prepare(runtime, task, role, plan.threadId),
    );
    if (Result.isFailure(prepared)) {
      yield* Effect.sync(() =>
        failThread(runtime, plan.threadId, task, role, now, prepared.failure.message),
      );
      return undefined;
    }
    const workspace = prepared.success;
    yield* Effect.sync(() =>
      store.updateThread(
        runtime.database,
        plan.threadId,
        threadTools.readOnly(role)
          ? { cwd: workspace.cwd }
          : { branch: workspace.branch, cwd: workspace.cwd, targetBranch: workspace.targetBranch },
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
            readOnly: threadTools.readOnly(role),
            sessionFile: plan.sessionFile,
            telemetry,
            thinkingLevel,
            tools: toolsFor(runtime, plan.threadId, role, task),
          }),
      }),
    );
    if (Result.isFailure(created)) {
      yield* Effect.sync(() =>
        failThread(runtime, plan.threadId, task, role, now, created.failure.message),
      );
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
  runtime.decisionRequests.delete(threadId);
  runtime.goalChecklists.delete(threadId);
  runtime.triageConclusions.delete(threadId);
  store.updateThread(runtime.database, threadId, { sessionFile: worker.sessionFile ?? null }, now);
  const reopened = runtime.workers.get(threadId) === worker;
  runtime.workers.set(threadId, worker);
  runtime.activity.set(threadId, { at: now, messages: worker.messages.length });
  if (!reopened) {
    worker.subscribe(() => {
      noteActivity(runtime, threadId, worker);
      runtime.publish();
    });
  }
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
): Effect.Effect<string | undefined, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const opened = yield* openWorker(runtime, plan, task, role, now);
    if (opened === undefined) return undefined;
    const workspace =
      plan.sessionFile === undefined ? threadWorkspace.block(role, opened.workspace) : "";
    const prompt = [plan.prompt, workspace].filter(Boolean).join("\n\n");
    yield* Effect.sync(() => launch(runtime, plan.threadId, opened.worker, prompt, now));
    return plan.threadId;
  });
}

function startTasks(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  role: orchestratorTypesTypes.ThreadRole,
  workerReport = "",
  extra = "",
): Effect.Effect<string | undefined, runtimeTypes.OrchestratorError> {
  if (task.status === "closed") {
    return Effect.fail(orchestratorError(closedTaskMessage(task.id)));
  }
  return Effect.suspend(() =>
    launchPlan(runtime, planThread(runtime, task, role, workerReport, extra), task, role),
  );
}

const starting = { failThread, launch, launchPlan, startTasks, threadModel };

const start = {
  starting,
};

export default start;
