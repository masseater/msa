import {
  type ConversationId,
  type TaskId,
  defineDoc,
  defineDocFamily,
  defineTask,
} from "@msa/durable";
import { Effect } from "effect";
import { dual } from "effect/Function";

import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";
import type sessionTablesSupportTypes from "./session-tables-support.types.ts";

const { awaited } = effectSupport;
const { context, openTestSession } = sessionSupport;

const WorkTask = defineTask<
  { path: string },
  sessionTablesSupportTypes.Checkpoint,
  { ok: boolean }
>({
  abort: () => Promise.resolve(),
  initial: () => ({ phase: "start" }),
  name: "test.work",
  phases: { next: () => Promise.resolve(), start: () => Promise.resolve() },
  version: 1,
});

const ProgressDoc = defineDoc<sessionTablesSupportTypes.Progress>({
  initial: () => ({ lines: [] }),
  kind: "test.progress",
  scope: "task",
  version: 1,
});

const StepDoc = defineDocFamily<sessionTablesSupportTypes.Progress, null>({
  family: true,
  initial: () => ({ lines: [] }),
  kind: "test.step",
  scope: "task",
  version: 1,
});

const NotesDoc = defineDoc<sessionTablesSupportTypes.Notes>({
  fork: "asOf",
  history: "rewindable",
  initial: () => ({ text: "" }),
  kind: "test.notes",
  scope: "conversation",
  version: 1,
});

function terminal(task: sessionTablesSupportTypes.AnyTask): sessionTablesSupportTypes.AnyTask {
  return {
    abortRequested: task.abortRequested,
    background: task.background,
    conversationId: task.conversationId,
    id: task.id,
    input: task.input,
    kind: task.kind,
    state: { outcome: { result: { ok: true }, status: "completed" }, status: "terminal" },
    version: task.version,
  };
}

function createTaskImpl(
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
                { conversationId, ownership: { kind: "conversation" } },
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

const createTask: {
  (
    conversationId: ConversationId,
    withDocument?: boolean,
  ): (session: ReturnType<typeof openTestSession>["session"]) => ReturnType<typeof createTaskImpl>;
  (
    session: ReturnType<typeof openTestSession>["session"],
    conversationId: ConversationId,
    withDocument?: boolean,
  ): ReturnType<typeof createTaskImpl>;
} = dual((args) => typeof args[0] === "object" && args[0] !== null, createTaskImpl);

const sessionTablesSupport = {
  NotesDoc,
  ProgressDoc,
  StepDoc,
  WorkTask,
  createTask,
  terminal,
};

export default sessionTablesSupport;
