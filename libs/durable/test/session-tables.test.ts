import { type ConversationId, type EntryId, ReadAfterWrite, type TaskId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import { awaited } from "./effect-support.ts";
import { context, createConversation, flush, openTestSession } from "./session-support.ts";
import { WorkTask, createTask, NotesDoc } from "./session-tables-support.ts";

const mintedRecords = Effect.fn("mintedRecords")(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage, publications } = openTestSession();
  const created = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const conversation = yield* awaited(
              tx.createConversation({ ownership: { kind: "ownerless" } }),
            );
            const first = yield* awaited(
              tx.appendEntry(conversation.id, { kind: "note", data: "one" }),
            );
            const headed = yield* awaited(
              tx.appendEntry(conversation.id, { kind: "summary", head: "self" }),
            );
            const task = yield* awaited(
              tx.createTask(
                WorkTask,
                { path: "x" },
                {
                  ownership: { kind: "conversation" },
                  conversationId: conversation.id,
                  background: true,
                },
              ),
            );
            return { conversation, first, headed, task };
          }),
        ),
      context,
    ),
  );
  return { session, storage, publications, created };
});

const distinctMintedRecords = Effect.fn("distinctMintedRecords")(function* () {
  const { session, storage, publications, created } = yield* mintedRecords();
  const ids = [created.conversation.id, created.first.id, created.headed.id, created.task];
  expect(new Set(ids).size).toBe(4);
  return { session, storage, publications, created };
});

const allowsTableReads = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            expect(yield* awaited(tx.conversation(conversationId))).toEqual({
              id: conversationId,
            });
            expect(yield* awaited(tx.scanConversations({}, 1))).toEqual({
              items: [{ id: conversationId }],
            });
            expect(yield* awaited(tx.scanTasks({ conversationId }, 10))).toEqual({
              items: [],
            });
            expect(yield* awaited(tx.scanEntries({ conversationId }, 10))).toEqual({
              items: [],
            });
            yield* awaited(tx.appendEntry(conversationId, { kind: "note" }));
            yield* awaited(
              expect(tx.conversation(conversationId)).rejects.toBeInstanceOf(ReadAfterWrite),
            );
            yield* awaited(
              expect(tx.task(idFromNumber<TaskId>(1))).rejects.toThrow(
                "Tx.task() cannot read tables after the first table write",
              ),
            );
            yield* awaited(
              expect(tx.entry(idFromNumber<EntryId>(1))).rejects.toBeInstanceOf(ReadAfterWrite),
            );
            yield* awaited(
              expect(tx.scanConversations({}, 10)).rejects.toBeInstanceOf(ReadAfterWrite),
            );
            yield* awaited(
              expect(tx.scanEntries({ conversationId }, 10)).rejects.toBeInstanceOf(ReadAfterWrite),
            );
            (yield* awaited(tx.doc(NotesDoc, conversationId))).text = "after write";
          }),
        ),
      context,
    ),
  );
  expect(yield* awaited(session.snapshot(NotesDoc, conversationId, context))).toEqual({
    text: "after write",
  });
});

const passesCallerSelected = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = openTestSession();
  const ids = [
    yield* awaited(createConversation(session)),
    yield* awaited(createConversation(session)),
    yield* awaited(createConversation(session)),
  ];
  yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const first = yield* awaited(tx.scanConversations({}, 2));
            expect(first.items.map(({ id }) => id)).toEqual(ids.slice(0, 2));
            expect(first.next).toBeDefined();
            const second = yield* awaited(tx.scanConversations({}, 2, first.next));
            expect(second.items.map(({ id }) => id)).toEqual(ids.slice(2));
            expect(second.next).toBeUndefined();
          }),
        ),
      context,
    ),
  );
});

describe("Session transaction tables", () => {
  it("allows table reads only before the first table write", () =>
    Effect.runPromise(allowsTableReads));

  it("passes caller-selected limits and cursors through table scans", () =>
    Effect.runPromise(passesCallerSelected));
});

const treatsSynchronousSetTask = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session } = openTestSession();
  const conversationId = yield* awaited(createConversation(session));
  const taskId = yield* awaited(createTask(session, conversationId));
  yield* awaited(
    session.commitWith(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const task = (yield* awaited(tx.task(taskId)))!;
            tx.setTask(task);
            yield* awaited(expect(tx.task(taskId)).rejects.toBeInstanceOf(ReadAfterWrite));
          }),
        ),
      context,
    ),
  );
});

describe("Session transaction tables", () => {
  it("treats synchronous setTask as the first table write", () =>
    Effect.runPromise(treatsSynchronousSetTask));
});

const createsConversationsEntriesStep1 = Effect.gen(function* () {
  const { session, storage, publications, created } = yield* distinctMintedRecords();
  expect(created.headed.head).toBe(created.headed.id);
  expect(created.first).toEqual({
    id: created.first.id,
    conversationId: created.conversation.id,
    kind: "note",
    data: "one",
  });
  expect((yield* awaited(storage.entry(created.headed.id, context)))!.entry).toEqual(
    created.headed,
  );
  expect(yield* awaited(storage.task(created.task, context))).toEqual({
    id: created.task,
    conversationId: created.conversation.id,
    kind: "test.work",
    version: 1,
    input: { path: "x" },
    background: true,
    abortRequested: false,
    state: { status: "pending", checkpoint: { phase: "start" } },
  });
  yield* flush;
  const changes = publications.at(-1)!.changes;
  expect(changes).toHaveLength(4);
  const admitted = storage.admittedCommits.at(-1)!;
  for (const change of changes) expect(admitted.some((write) => write === change)).toBe(true);
  expect(changes.map((change) => change.type)).toEqual(
    expect.arrayContaining(["conversation", "entry", "entry", "task"]),
  );
  expect(changes.find((change) => change.type === "conversation")!.value).toBe(
    created.conversation,
  );
  const entries = changes.filter((change) => change.type === "entry");
  expect(entries.map((change) => change.value)).toContain(created.first);
  expect(entries.map((change) => change.value)).toContain(created.headed);
  yield* awaited(
    expect(
      session.commit(
        (tx) => tx.createTask(WorkTask, { path: "x" }, { ownership: { kind: "conversation" } }),
        context,
      ),
    ).rejects.toThrow("requires options.conversationId"),
  );
  return { session };
});

const createsConversationsEntries = Effect.gen(function* () {
  const { session } = yield* createsConversationsEntriesStep1;
  yield* awaited(
    expect(
      session.commit(
        (tx) => tx.appendEntry(idFromNumber<ConversationId>(12345), { kind: "note" }),
        context,
      ),
    ).rejects.toThrow("Conversation 12345 does not exist"),
  );
});

describe("Session transaction tables", () => {
  it("creates conversations, entries, and tasks with minted IDs", () =>
    Effect.runPromise(createsConversationsEntries));
});

const createsConversationExplicitlyStep1 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const { session, storage } = openTestSession();
  const parentId = yield* awaited(createConversation(session));
  const created = yield* awaited(
    session.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const supervisorId = yield* awaited(
              tx.createTask(
                WorkTask,
                { path: "background" },
                {
                  ownership: { kind: "conversation" },
                  conversationId: parentId,
                  background: true,
                },
              ),
            );
            const child = yield* awaited(
              tx.createConversation({
                ownership: { kind: "task", taskId: supervisorId },
              }),
            );
            return { supervisorId, child };
          }),
        ),
      context,
    ),
  );

  expect(created.child.owner).toEqual({
    conversationId: parentId,
    taskId: created.supervisorId,
  });
  expect(yield* awaited(storage.conversation(created.child.id, context))).toEqual(created.child);
  return { runPromise, session, storage, parentId, created };
});

const createsConversationExplicitly = Effect.gen(function* () {
  const { runPromise, session, storage, parentId, created } =
    yield* createsConversationExplicitlyStep1;
  yield* awaited(
    expect(
      session.commitWith(
        (tx) =>
          runPromise(
            Effect.gen(function* () {
              const supervisor = (yield* awaited(tx.task(created.supervisorId)))!;
              tx.setTask({ ...supervisor, conversationId: created.child.id });
            }),
          ),
        context,
      ),
    ).rejects.toThrow(`Task ${created.supervisorId} cannot change conversations`),
  );
  expect((yield* awaited(storage.task(created.supervisorId, context)))?.conversationId).toBe(
    parentId,
  );
});

describe("Session transaction tables", () => {
  it("creates a conversation with an explicitly staged task owner", () =>
    Effect.runPromise(createsConversationExplicitly));
});
