import { Effect, Result } from "effect";

import errors from "./errors.ts";
import reviewHold from "./review-hold.ts";
import type runtimeTypes from "./runtime.types.ts";
import startModule from "./start.ts";
import storeModule from "./store.ts";
import taskCwd from "./task-cwd.ts";
import threadTools from "./thread-tools.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import worktreeModule from "./worktree.ts";

const { orchestratorError } = errors;
const { worktrees } = worktreeModule;
const { failThread, refuseStart } = startModule.starting;
const { store } = storeModule;
const { toolsFor } = threadTools;

interface ReopenTarget {
  thread: orchestratorTypesTypes.Thread;
  role: orchestratorTypesTypes.ThreadRole;
  request: string;
}

function lastAsker(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): ReopenTarget | undefined {
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

function reopenTarget(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  decision: string,
  now: number,
): Effect.Effect<ReopenTarget | "held" | undefined> {
  return Effect.gen(function* () {
    const target = lastAsker(runtime, task);
    if (target?.role !== "reviewer") return target;
    const held = yield* reviewHold.holdReview(runtime, task, target.thread.id, now, decision);
    return held ? "held" : target;
  });
}

function reopenWorker(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  thread: orchestratorTypesTypes.Thread,
  role: orchestratorTypesTypes.ThreadRole,
  now: number,
): Effect.Effect<runtimeTypes.WorkerSession | undefined, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    const open = runtime.workers.get(thread.id);
    if (open !== undefined) return open;
    const prepared = yield* Effect.result(worktrees.prepare(runtime, task));
    if (Result.isFailure(prepared) && taskCwd.isUncheckable(prepared.failure)) {
      yield* Effect.sync(() => refuseStart(runtime, task, role, prepared.failure.message, now));
      return undefined;
    }
    if (Result.isFailure(prepared)) {
      yield* Effect.sync(() =>
        failThread(runtime, thread.id, task, role, now, prepared.failure.message),
      );
      return undefined;
    }
    const telemetry = runtime.telemetry.threadStarted(
      { model: thread.model, role, thinkingLevel: thread.thinkingLevel, threadId: thread.id },
      task,
    );
    const created = yield* Effect.result(
      Effect.tryPromise({
        catch: orchestratorError,
        try: () =>
          runtime.options.createWorker({
            cwd: prepared.success.cwd,
            model: runtime.options.resolveModel(thread.model),
            readOnly: false,
            sessionFile: thread.sessionFile ?? undefined,
            telemetry,
            thinkingLevel: thread.thinkingLevel,
            tools: toolsFor(runtime, thread.id, role, task),
          }),
      }),
    );
    if (Result.isFailure(created)) {
      yield* Effect.sync(() =>
        failThread(runtime, thread.id, task, role, now, created.failure.message),
      );
      return undefined;
    }
    return created.success;
  });
}

const reopenModule = { reopenTarget, reopenWorker };

export default reopenModule;
