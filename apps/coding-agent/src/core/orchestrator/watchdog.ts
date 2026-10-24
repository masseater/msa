import { Effect, Fiber } from "effect";

import elapsedModule from "../../utils/elapsed.ts";
import processAliveModule from "../platform/node/process-alive.ts";
import errors from "./errors.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import storeModule from "./store.ts";
import watchdogInspect from "./watchdog-inspect.ts";
import type watchdogTypes from "./watchdog.types.ts";

const { nowMillis, releaseThread } = runtimeModule;
const { orchestratorError } = errors;
const { store } = storeModule;
const { scheduling } = schedule;
const { formatElapsed } = elapsedModule;
const { INTERVAL_MS, inspect } = watchdogInspect;
const { currentPid, processAlive } = processAliveModule;

function release(runtime: runtimeTypes.Runtime, threadId: string): void {
  const worker = runtime.workers.get(threadId);
  runtime.runs.delete(threadId);
  runtime.runStartedAt.delete(threadId);
  runtime.activity.delete(threadId);
  runtime.wrapUps.delete(threadId);
  releaseThread(runtime, threadId);
  void worker?.run.lifecycle.abort().catch(() => undefined);
}

function taskLabel(runtime: runtimeTypes.Runtime, taskId: string): string {
  const task = store.getTask(runtime.database, taskId);
  return task === undefined ? taskId : `${task.title} (${taskId})`;
}

function resolveFinding(
  runtime: runtimeTypes.Runtime,
  finding: watchdogTypes.Finding,
  now: number,
): void {
  const database = runtime.database;
  const { thread } = finding;
  release(runtime, thread.id);
  store.updateThread(database, thread.id, { status: finding.threadStatus }, now);
  const assignments = store.assignmentsOfThread(database, thread.id);
  const content = `Watchdog: thread ${thread.id} stopped because ${finding.reason}.`;
  for (const assignment of assignments) {
    if (store.getTask(database, assignment.taskId)?.status !== "running") continue;
    store.insertReport(database, {
      content,
      createdAt: now,
      id: `rep-${thread.id}-${assignment.taskId}-watchdog`,
      role: assignment.role,
      status: finding.threadStatus,
      taskId: assignment.taskId,
      threadId: thread.id,
      verdict: null,
    });
    store.setTaskStatus(database, assignment.taskId, finding.taskStatus, now);
  }
  const first = assignments[0];
  const tasks = assignments.map((assignment) => taskLabel(runtime, assignment.taskId));
  runtime.options.report(
    [
      `${tasks.length > 0 ? tasks.join(", ") : `Thread ${thread.id}`} ${finding.taskStatus}.`,
      `${content} Rerun the task to continue.`,
    ].join("\n\n"),
    {
      role: first?.role ?? "worker",
      started: [],
      status: finding.taskStatus,
      taskId: first?.taskId ?? thread.id,
    },
  );
}

function resolveTaskWithoutThread(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  now: number,
): void {
  const task = store.getTask(runtime.database, taskId);
  if (task === undefined) return;
  store.setTaskStatus(runtime.database, taskId, "stopped", now);
  runtime.options.report(
    `${taskLabel(runtime, taskId)} stopped.\n\nWatchdog: the task was running with no running thread for ${formatElapsed(now - task.updatedAt)}. Rerun the task to continue.`,
    { role: "worker", started: [], status: "stopped", taskId },
  );
}

function recoverElsewhere(runtime: runtimeTypes.Runtime, now: number): number {
  const dead = store
    .deadOwnerProjects(runtime.database, runtime.options.project)
    .filter(({ ownerPid }) => !processAlive(ownerPid));
  for (const { ownerPid, project } of dead) {
    store.recoverProject(
      runtime.database,
      project,
      `its orchestrator process ${ownerPid} was gone`,
      now,
    );
  }
  return dead.length;
}

function sweepEffect(runtime: runtimeTypes.Runtime) {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const changed = yield* Effect.sync(() => {
      const findings = inspect(runtime, now);
      for (const finding of findings) resolveFinding(runtime, finding, now);
      const taskIds = store.runningTasksWithoutThread(runtime.database, runtime.options.project);
      for (const taskId of taskIds) resolveTaskWithoutThread(runtime, taskId, now);
      return findings.length + taskIds.length + recoverElsewhere(runtime, now);
    });
    if (changed === 0) return;
    yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
  });
}

function startWatchdog(runtime: runtimeTypes.Runtime): Fiber.Fiber<never, never> {
  return Effect.runFork(
    Effect.forever(
      Effect.sleep(INTERVAL_MS).pipe(
        Effect.andThen(
          Effect.tryPromise({
            catch: orchestratorError,
            try: () => runtime.exclusive(sweepEffect(runtime)),
          }).pipe(Effect.ignore),
        ),
      ),
    ),
  );
}

function reportRecovered(runtime: runtimeTypes.Runtime): void {
  if (!runtime.database.isOpen) return;
  const notices = store.takeRecoveryNotices(runtime.database, runtime.options.project);
  const first = notices[0];
  if (first === undefined) return;
  const lines = notices.map(
    (notice) =>
      `- ${notice.title} (${notice.taskId}): running when ${notice.cause}, ${formatElapsed(notice.recoveredAt - notice.lastUpdate)} after its last update`,
  );
  runtime.options.report(
    [
      `${notices.length === 1 ? "A task was" : `${notices.length} tasks were`} left running by an earlier orchestrator and are waiting again; the scheduler restarts them.`,
      lines.join("\n"),
    ].join("\n\n"),
    { role: "worker", started: [], status: "waiting", taskId: first.taskId },
  );
}

function open(runtime: runtimeTypes.Runtime, now: number): void {
  store.recoverProject(runtime.database, runtime.options.project, "the session reopened", now);
  store.claimProject(runtime.database, runtime.options.project, currentPid());
}

function close(runtime: runtimeTypes.Runtime, now: number): void {
  store.recoverProject(runtime.database, runtime.options.project, "the session closed", now);
  store.releaseProject(runtime.database, runtime.options.project, currentPid());
}

const watchdog = { close, open, reportRecovered, startWatchdog };

const watchdogModule = {
  watchdog,
};

export default watchdogModule;
