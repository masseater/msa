import { Effect } from "effect";

import type { OrchestratorError } from "./errors.ts";
import { outcomes } from "./outcome.ts";
import { prompts } from "./prompts.ts";
import { type Runtime, nowMillis } from "./runtime.ts";
import { scheduling } from "./schedule.ts";
import { starting } from "./start.ts";
import { store } from "./store.ts";
import type { WorkerSession } from "./worker.ts";
import { wrapping } from "./wrap-up.ts";

function settleEffect(
  runtime: Runtime,
  threadId: string,
  run: number,
  worker: WorkerSession,
  error: unknown,
): Effect.Effect<void, OrchestratorError> {
  return Effect.gen(function* () {
    if (runtime.runs.get(threadId) !== run) return;
    const now = yield* nowMillis;
    const thread = store.getThread(runtime.database, threadId);
    if (thread === undefined) return;
    const assignments = store.assignmentsOfThread(runtime.database, threadId);
    runtime.runs.delete(threadId);
    runtime.runStartedAt.delete(threadId);
    const outcome = outcomes.outcomeOf(worker, error);
    if (outcome.status !== "completed") {
      wrapping.fail(runtime, threadId, `wrap-up failed: ${outcome.content}`);
    }
    const review = yield* Effect.sync(() => {
      store.updateThread(runtime.database, threadId, { status: outcome.status }, now);
      return outcomes.applyOutcome(runtime, assignments, outcome, now);
    });
    for (const task of review) {
      yield* starting.startTasks(runtime, task, "reviewer", outcome.content);
    }
    const started = yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => {
      runtime.publish();
      const first = assignments[0];
      runtime.options.report(outcomes.reportText(runtime, assignments, outcome, started), {
        role: first?.role ?? "worker",
        started,
        status: outcome.status === "completed" ? "completed" : "failed",
        taskId: first?.taskId ?? threadId,
      });
    });
  });
}

function settle(
  runtime: Runtime,
  threadId: string,
  run: number,
  worker: WorkerSession,
  error: unknown,
): Promise<void> {
  return runtime.exclusive(settleEffect(runtime, threadId, run, worker, error));
}

function afterTurn(runtime: Runtime, threadId: string, run: number, worker: WorkerSession): void {
  if (runtime.runs.get(threadId) !== run) return;
  const handled = wrapping.takeOver(runtime, threadId, worker, {
    settle: (error: unknown) => void settle(runtime, threadId, run, worker, error),
    turn: () => afterTurn(runtime, threadId, run, worker),
  });
  if (handled) return;
  const assignments = store.assignmentsOfThread(runtime.database, threadId);
  const taskIds = assignments.map((assignment) => assignment.taskId);
  const notes = taskIds.flatMap((taskId) =>
    store.unreadNotes(runtime.database, runtime.options.project, taskId, threadId),
  );
  const pending = [...new Map(notes.map((note) => [note.id, note])).values()];
  if (pending.length === 0) {
    void settle(runtime, threadId, run, worker, undefined);
    return;
  }
  const now = Effect.runSync(nowMillis);
  for (const note of pending) store.markNoteRead(runtime.database, note.id, threadId, now);
  void worker.prompt(prompts.notesBlock(pending)).then(
    () => afterTurn(runtime, threadId, run, worker),
    (error: unknown) => settle(runtime, threadId, run, worker, error),
  );
}

export const settling = { afterTurn, settle };
