import type { JsonValue } from "@msa/chord";
import {
  type ConversationId,
  defineDoc,
  defineDocFamily,
  defineTask,
  type TaskId,
  type TaskRecord,
} from "@msa/durable";
import { Effect } from "effect";

import { awaited } from "./effect-support.ts";
import { context, openTestSession } from "./session-support.ts";

export type Checkpoint = { phase: "start" } | { phase: "next"; step: number };

export const WorkTask = defineTask<{ path: string }, Checkpoint, { ok: boolean }>({
  name: "test.work",
  version: 1,
  initial: () => ({ phase: "start" }),
  phases: { start: () => Promise.resolve(), next: () => Promise.resolve() },
  abort: () => Promise.resolve(),
});

export type Progress = { lines: string[] };

export const ProgressDoc = defineDoc<Progress>({
  kind: "test.progress",
  version: 1,
  scope: "task",
  initial: () => ({ lines: [] }),
});

export const StepDoc = defineDocFamily<Progress, null>({
  kind: "test.step",
  version: 1,
  family: true,
  scope: "task",
  initial: () => ({ lines: [] }),
});

export type Notes = { text: string };

export const NotesDoc = defineDoc<Notes>({
  kind: "test.notes",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ text: "" }),
});

export type AnyTask = TaskRecord<JsonValue, JsonValue, JsonValue>;

export function terminal(task: AnyTask): AnyTask {
  return {
    id: task.id,
    conversationId: task.conversationId,
    kind: task.kind,
    version: task.version,
    input: task.input,
    background: task.background,
    abortRequested: task.abortRequested,
    state: { status: "terminal", outcome: { status: "completed", result: { ok: true } } },
  };
}

export function createTask(
  session: ReturnType<typeof openTestSession>["session"],
  conversationId: ConversationId,
  withDocument = false,
): Promise<TaskId<{ ok: boolean }>> {
  return Promise.resolve(
    session.commit(
      (tx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const taskId = yield* awaited(
              tx.createTask(
                WorkTask,
                { path: "a" },
                { ownership: { kind: "conversation" }, conversationId },
              ),
            );
            if (withDocument) (yield* awaited(tx.doc(ProgressDoc, taskId))).lines.push("started");
            return taskId;
          }),
        ),
      context,
    ),
  );
}
