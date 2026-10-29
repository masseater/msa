import { Effect } from "effect";

import goalChecksModule from "./goal-checks.ts";
import promptsModule from "./prompts.ts";
import reviewJudgeModule from "./review-judge.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import wrapUp from "./wrap-up.ts";

const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { wrapping } = wrapUp;
const { prompts } = promptsModule;
const { goalChecks } = goalChecksModule;
const { reviewJudge } = reviewJudgeModule;

function afterTurn(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  run: number,
  worker: runtimeTypes.WorkerSession,
): void {
  if (runtime.runs.get(threadId) !== run) return;
  const handled = wrapping.takeOver(runtime, threadId, worker, {
    settle: (error: unknown) => runtime.settle(threadId, run, worker, error),
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
    const request = runtime.decisionRequests.get(threadId);
    if (request !== undefined) {
      runtime.launch(
        Effect.promise(() => runtime.settle(threadId, run, worker, undefined, undefined, request)),
      );
      return;
    }
    if (!reviewJudge.judge(runtime, threadId, run, worker))
      goalChecks.verify(runtime, threadId, run, worker);
    return;
  }
  runtime.decisionRequests.delete(threadId);
  const now = Effect.runSync(nowMillis);
  for (const note of pending) store.markNoteRead(runtime.database, note.id, threadId, now);
  runtime.launch(
    Effect.promise(() =>
      worker.run.prompting.prompt(prompts.notesBlock(pending)).then(
        () => afterTurn(runtime, threadId, run, worker),
        (error: unknown) => runtime.settle(threadId, run, worker, error),
      ),
    ),
  );
}

const afterTurns = { afterTurn };

const afterTurnModule = { afterTurns };

export default afterTurnModule;
