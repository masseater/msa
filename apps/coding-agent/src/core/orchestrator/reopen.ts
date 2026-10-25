import { Effect, Result } from "effect";

import errors from "./errors.ts";
import type runtimeTypes from "./runtime.types.ts";
import startModule from "./start.ts";
import threadTools from "./thread-tools.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import worktreeModule from "./worktree.ts";

const { orchestratorError } = errors;
const { worktrees } = worktreeModule;
const { failThread } = startModule.starting;
const { toolsFor } = threadTools;

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

const reopenModule = { reopenWorker };

export default reopenModule;
