import { Effect } from "effect";

import type { OrchestratorError } from "./errors.ts";
import { outcomes } from "./outcome.ts";
import { prompts } from "./prompts.ts";
import { type Runtime, nowMillis } from "./runtime.ts";
import { scheduling } from "./schedule.ts";
import { starting } from "./start.ts";
import { store } from "./store.ts";
import type { WorkerSession } from "./worker.ts";

function settleEffect(
  runtime: Runtime,
  sessionId: string,
  run: number,
  worker: WorkerSession,
  error: unknown,
): Effect.Effect<void, OrchestratorError> {
  return Effect.gen(function* () {
    if (runtime.runs.get(sessionId) !== run) return;
    const now = yield* nowMillis;
    const session = store.getSession(runtime.database, sessionId);
    if (session === undefined) return;
    const assignments = store.assignmentsOfSession(runtime.database, sessionId);
    runtime.runs.delete(sessionId);
    runtime.runStartedAt.delete(sessionId);
    const outcome = outcomes.outcomeOf(worker, error);
    const review = yield* Effect.sync(() => {
      store.updateSession(runtime.database, sessionId, { status: outcome.status }, now);
      return outcomes.applyOutcome(runtime, assignments, outcome, now);
    });
    if (review.length > 0) yield* starting.startTasks(runtime, review, "reviewer", outcome.content);
    const started = yield* scheduling.scheduleEffect(runtime);
    yield* Effect.sync(() => {
      runtime.publish();
      const first = assignments[0];
      runtime.options.report(outcomes.reportText(runtime, assignments, outcome, started), {
        taskId: first?.taskId ?? sessionId,
        role: first?.role ?? "worker",
        status: outcome.status === "completed" ? "completed" : "failed",
        started,
      });
    });
  });
}

function settle(
  runtime: Runtime,
  sessionId: string,
  run: number,
  worker: WorkerSession,
  error: unknown,
): Promise<void> {
  return runtime.exclusive(settleEffect(runtime, sessionId, run, worker, error));
}

function afterTurn(
  runtime: Runtime,
  sessionId: string,
  run: number,
  worker: WorkerSession,
): void {
  if (runtime.runs.get(sessionId) !== run) return;
  const assignments = store.assignmentsOfSession(runtime.database, sessionId);
  const taskIds = assignments.map((assignment) => assignment.taskId);
  const notes = taskIds.flatMap((taskId) =>
    store.unreadNotes(runtime.database, runtime.options.project, taskId, sessionId),
  );
  const pending = [...new Map(notes.map((note) => [note.id, note])).values()];
  if (pending.length === 0) {
    void settle(runtime, sessionId, run, worker, undefined);
    return;
  }
  const now = Effect.runSync(nowMillis);
  for (const note of pending) store.markNoteRead(runtime.database, note.id, sessionId, now);
  void worker.prompt(prompts.notesBlock(pending)).then(
    () => afterTurn(runtime, sessionId, run, worker),
    (error: unknown) => settle(runtime, sessionId, run, worker, error),
  );
}

export const settling = { settle, afterTurn };
