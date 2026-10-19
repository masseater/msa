import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { awaited } from "./effect-support.ts";
import {
  context,
  createConversation,
  documentChanges,
  flush,
  openTestSession,
} from "./session-support.ts";
import { WorkTask, createTask, ProgressDoc, StepDoc, terminal } from "./session-tables-support.ts";

const replacesTaskRecords = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  const taskId = yield* awaited(createTask(session, conversationId));
  yield* awaited(
    session.commitWith(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const task = (yield* awaited(tx.task(taskId)))!;
            tx.setTask({
              id: task.id,
              conversationId: task.conversationId,
              kind: task.kind,
              version: task.version,
              input: task.input,
              background: task.background,
              abortRequested: task.abortRequested,
              state: { status: "running", checkpoint: { phase: "next", step: 2 } },
              memos: { choice: "b" },
            });
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(storage.task(taskId, context))).toMatchObject({
    state: { status: "running", checkpoint: { phase: "next", step: 2 } },
    memos: { choice: "b" },
  });
});

describe("Session transaction tables", () => {
  it("replaces task records completely", () => Effect.runPromise(replacesTaskRecords));
});

const createsTaskDocumentStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, publications } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  const taskId = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const createdTaskId = yield* awaited(
              tx.createTask(
                WorkTask,
                { path: "a" },
                { ownership: { kind: "conversation" }, conversationId },
              ),
            );
            (yield* awaited(tx.doc(ProgressDoc, createdTaskId))).lines.push("created");
            (yield* awaited(tx.doc(StepDoc, createdTaskId, "one", null))).lines.push("step");
            return createdTaskId;
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(session.snapshot(ProgressDoc, taskId, context))).toEqual({
    lines: ["created"],
  });
  yield* flush;
  const publication = publications.at(-1)!;
  const documents = documentChanges(publication);
  expect(publication.changes).toContainEqual(
    expect.objectContaining({ type: "task", value: expect.objectContaining({ id: taskId }) }),
  );
  expect(documents).toHaveLength(2);
  for (const document of documents) expect(document.conversationId).toBe(conversationId);
  return { runPromise, session, publications, conversationId, taskId };
});

const createsTaskDocument = Effect.gen(function* () {
  const { runPromise, session, publications, conversationId, taskId } =
    yield* createsTaskDocumentStep1;
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            yield* awaited(tx.createConversation({ ownership: { kind: "ownerless" } }));
            (yield* awaited(tx.doc(ProgressDoc, taskId))).lines.push("committed task");
          }),
        ),
      context,
    ),
  );
  yield* flush;
  expect(documentChanges(publications.at(-1)!)[0]!.conversationId).toBe(conversationId);
});

describe("Session transaction tables", () => {
  it("creates a task and then its document in one transaction without ReadAfterWrite", () =>
    Effect.runPromise(createsTaskDocument));
});

const rejectsTaskDocuments = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  const taskId = yield* awaited(createTask(session, conversationId, true));
  yield* awaited(
    session.commitWith(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const task = (yield* awaited(tx.task(taskId)))!;
            const progress = yield* awaited(tx.doc(ProgressDoc, taskId));
            tx.setTask(terminal(task));
            yield* awaited(
              expect(tx.doc(ProgressDoc, taskId)).rejects.toThrow(`Task ${taskId} is terminal`),
            );
            yield* awaited(
              expect(tx.doc(StepDoc, taskId, "late", null)).rejects.toThrow(
                `Task ${taskId} is terminal`,
              ),
            );
            expect(() => tx.setTask(task)).toThrow("terminal candidate");
            progress.lines.push("final");
          }),
        ),
      context,
    ),
  );
  yield* awaited(
    expect(
      session.commit((tx) => tx.doc(ProgressDoc, taskId).then(() => undefined), context),
    ).rejects.toThrow(`Task ${taskId} is terminal`),
  );
});

describe("Session transaction tables", () => {
  it("rejects task documents after a terminal candidate", () =>
    Effect.runPromise(rejectsTaskDocuments));
});
