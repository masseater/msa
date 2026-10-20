import { type ConversationId, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import effectSupport from "./effect-support.ts";
import sessionSupport from "./session-support.ts";
import sessionTablesSupport from "./session-tables-support.ts";

const { awaited } = effectSupport;
const { context, createConversation, documentChanges, flush, openTestSession } = sessionSupport;
const { NotesDoc, ProgressDoc, StepDoc, createTask, terminal } = sessionTablesSupport;

const retiresTaskDocumentsStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  const taskId = yield* awaited(createTask(session, conversationId, true));
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            (yield* awaited(tx.doc(StepDoc, taskId, "committed", null))).lines.push("x");
          }),
        ),
      context,
    ),
  );
  yield* flush;
  const published = publications.length;
  yield* awaited(
    session.commitWith(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const task = (yield* awaited(tx.task(taskId)))!;
            (yield* awaited(tx.doc(StepDoc, taskId, "new", null))).lines.push(
              "created then retired",
            );
            tx.setTask(terminal(task));
          }),
        ),
      context,
    ),
  );
  const writes = storage.commits.at(-1)!;
  return { conversationId, publications, published, runPromise, session, storage, taskId, writes };
});

const retiresTaskDocumentsStep2 = Effect.gen(function* () {
  const { runPromise, session, storage, publications, conversationId, taskId, published, writes } =
    yield* retiresTaskDocumentsStep1;
  expect(writes).toHaveLength(5);
  expect(writes.filter((write) => write.type === "task")).toHaveLength(1);
  const creations = writes.filter((write) => write.type === "document.create");
  const retirements = writes.filter((write) => write.type === "document.retire");
  expect(creations).toHaveLength(1);
  expect(retirements).toHaveLength(3);
  expect(retirements.map((write) => write.id)).toContain(creations[0]!.record.id);
  yield* flush;
  expect(publications.length).toBe(published + 1);
  const publication = publications.at(-1)!;
  const documents = documentChanges(publication);
  expect(publication.changes.filter((change) => change.type === "task")).toHaveLength(1);
  expect(documents.map((document) => document.value)).toEqual([null, null, null]);
  for (const document of documents) expect(document.ops).toEqual([]);
  for (const document of documents) expect(document.conversationId).toBe(conversationId);
  expect(yield* awaited(session.snapshot(ProgressDoc, taskId, context))).toBeUndefined();
  expect(yield* awaited(session.snapshot(StepDoc, taskId, "committed", context))).toBeUndefined();
  const alive = yield* awaited(
    storage.scanDocuments(
      { at: "current", scope: { kind: "task", taskId } },
      10,
      undefined,
      context,
    ),
  );
  expect(alive.items).toEqual([]);
  return { runPromise, session, taskId };
});

const retiresTaskDocuments = Effect.gen(function* () {
  const { runPromise, session, taskId } = yield* retiresTaskDocumentsStep2;
  yield* awaited(
    expect(
      session.commitWith(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              tx.setTask(terminal((yield* awaited(tx.task(taskId)))!));
            }),
          ),
        context,
      ),
    ).rejects.toThrow(`Task ${taskId} is already terminal`),
  );
});

describe("Session transaction tables", () => {
  it("retires task documents at terminal settlement, including documents created in the same transaction", () =>
    Effect.runPromise(retiresTaskDocuments));
});

const validatesDocumentOwners = Effect.gen(function* () {
  const { session } = openTestSession();
  yield* awaited(
    expect(
      session.commit(
        (tx) => tx.doc(ProgressDoc, idFromNumber<TaskId>(4242)).then(() => undefined),
        context,
      ),
    ).rejects.toThrow("Task 4242 does not exist"),
  );
  yield* awaited(
    expect(
      session.commit(
        (tx) => tx.doc(NotesDoc, idFromNumber<ConversationId>(4242)).then(() => undefined),
        context,
      ),
    ).rejects.toThrow("Conversation 4242 does not exist"),
  );
});

describe("Session transaction tables", () => {
  it("validates document owners", () => Effect.runPromise(validatesDocumentOwners));
});
