import { Effect } from "effect";

import processAliveModule from "../platform/node/process-alive.ts";
import errors from "./errors.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import storeModule from "./store.ts";
import watchdogInspect from "./watchdog-inspect.ts";
import watchdogReport from "./watchdog-report.ts";
import type watchdogTypes from "./watchdog.types.ts";

const { abortThread, nowMillis } = runtimeModule;
const { orchestratorError } = errors;
const { store } = storeModule;
const { scheduling } = schedule;
const { INTERVAL_MS, inspect } = watchdogInspect;
const { currentPid, processAlive } = processAliveModule;

function locked(runtime: runtimeTypes.Runtime): runtimeTypes.Write {
  return (effect) => Effect.promise(() => runtime.exclusive(effect));
}

function resolveFinding(
  runtime: runtimeTypes.Runtime,
  finding: watchdogTypes.Finding,
  now: number,
): Effect.Effect<void> {
  const database = runtime.database;
  const { thread } = finding;
  abortThread(runtime, thread.id);
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
  const taskIds = assignments.map((assignment) => assignment.taskId);
  return Effect.map(
    watchdogReport.findingText(
      runtime,
      thread.id,
      taskIds,
      finding.taskStatus,
      content,
      locked(runtime),
    ),
    (text) =>
      runtime.options.report(text, {
        role: first?.role ?? "worker",
        started: [],
        status: finding.taskStatus,
        taskId: first?.taskId ?? thread.id,
      }),
  );
}

function resolveTaskWithoutThread(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  now: number,
): Effect.Effect<void> {
  const task = store.getTask(runtime.database, taskId);
  if (task === undefined) return Effect.void;
  store.setTaskStatus(runtime.database, taskId, "stopped", now);
  return Effect.map(
    watchdogReport.threadlessText(runtime, taskId, now - task.updatedAt, locked(runtime)),
    (text) =>
      runtime.options.report(text, { role: "worker", started: [], status: "stopped", taskId }),
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

function sweepEffect(
  runtime: runtimeTypes.Runtime,
): Effect.Effect<Effect.Effect<void>[], runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    const findings = inspect(runtime, now);
    const reports = findings.map((finding) => resolveFinding(runtime, finding, now));
    const taskIds = store.runningTasksWithoutThread(runtime.database, runtime.options.project);
    reports.push(...taskIds.map((taskId) => resolveTaskWithoutThread(runtime, taskId, now)));
    const changed = findings.length + taskIds.length + recoverElsewhere(runtime, now);
    if (changed === 0) return reports;
    yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => runtime.publish());
    return reports;
  });
}

function watchdogLoop(runtime: runtimeTypes.Runtime): Effect.Effect<never> {
  return Effect.forever(
    Effect.sleep(INTERVAL_MS).pipe(
      Effect.andThen(
        Effect.tryPromise({
          catch: orchestratorError,
          try: () => runtime.exclusive(sweepEffect(runtime)),
        }).pipe(
          Effect.flatMap((reports) =>
            Effect.forEach(reports, (report) => report, { discard: true }),
          ),
          Effect.ignore,
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
  runtime.options.report(watchdogReport.recoveredText(notices), {
    role: "worker",
    started: [],
    status: "waiting",
    taskId: first.taskId,
  });
}

function open(runtime: runtimeTypes.Runtime, now: number): void {
  store.recoverProject(runtime.database, runtime.options.project, "the session reopened", now);
  store.claimProject(runtime.database, runtime.options.project, currentPid());
}

function close(runtime: runtimeTypes.Runtime, now: number): void {
  store.recoverProject(runtime.database, runtime.options.project, "the session closed", now);
  store.releaseProject(runtime.database, runtime.options.project, currentPid());
}

const watchdog = { close, loop: watchdogLoop, open, reportRecovered };

const watchdogModule = {
  watchdog,
};

export default watchdogModule;
