import { type ConversationId, type EntryId, ReadAfterWrite, type TaskId } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import { context, createConversation, flush, openTestSession } from "./session-support.ts";
import { WorkTask, createTask, NotesDoc } from "./session-tables-support.ts";

async function mintedRecords() {
  const { session, storage, publications } = openTestSession();
  const created = await session.commit(async (tx) => {
    const conversation = await tx.createConversation({ ownership: { kind: "ownerless" } });
    const first = await tx.appendEntry(conversation.id, { kind: "note", data: "one" });
    const headed = await tx.appendEntry(conversation.id, { kind: "summary", head: "self" });
    const task = await tx.createTask(
      WorkTask,
      { path: "x" },
      { ownership: { kind: "conversation" }, conversationId: conversation.id, background: true },
    );
    return { conversation, first, headed, task };
  }, context);
  return { session, storage, publications, created };
}

async function distinctMintedRecords() {
  const { session, storage, publications, created } = await mintedRecords();
  const ids = [created.conversation.id, created.first.id, created.headed.id, created.task];
  expect(new Set(ids).size).toBe(4);
  return { session, storage, publications, created };
}

describe("Session transaction tables", () => {
  it("allows table reads only before the first table write", async () => {
    const { session } = openTestSession();
    const conversationId = await createConversation(session);
    await session.commit(async (tx) => {
      expect(await tx.conversation(conversationId)).toEqual({ id: conversationId });
      expect(await tx.scanConversations({}, 1)).toEqual({ items: [{ id: conversationId }] });
      expect(await tx.scanTasks({ conversationId }, 10)).toEqual({ items: [] });
      expect(await tx.scanEntries({ conversationId }, 10)).toEqual({ items: [] });
      await tx.appendEntry(conversationId, { kind: "note" });
      await expect(tx.conversation(conversationId)).rejects.toBeInstanceOf(ReadAfterWrite);
      await expect(tx.task(idFromNumber<TaskId>(1))).rejects.toThrow(
        "Tx.task() cannot read tables after the first table write",
      );
      await expect(tx.entry(idFromNumber<EntryId>(1))).rejects.toBeInstanceOf(ReadAfterWrite);
      await expect(tx.scanConversations({}, 10)).rejects.toBeInstanceOf(ReadAfterWrite);
      await expect(tx.scanEntries({ conversationId }, 10)).rejects.toBeInstanceOf(ReadAfterWrite);
      // Document access remains available after table writes.
      (await tx.doc(NotesDoc, conversationId)).text = "after write";
    }, context);
    expect(await session.snapshot(NotesDoc, conversationId, context)).toEqual({
      text: "after write",
    });
  });

  it("passes caller-selected limits and cursors through table scans", async () => {
    const { session } = openTestSession();
    const ids = [
      await createConversation(session),
      await createConversation(session),
      await createConversation(session),
    ];
    await session.commit(async (tx) => {
      const first = await tx.scanConversations({}, 2);
      expect(first.items.map(({ id }) => id)).toEqual(ids.slice(0, 2));
      expect(first.next).toBeDefined();
      const second = await tx.scanConversations({}, 2, first.next);
      expect(second.items.map(({ id }) => id)).toEqual(ids.slice(2));
      expect(second.next).toBeUndefined();
    }, context);
  });
});

describe("Session transaction tables", () => {
  it("treats synchronous setTask as the first table write", async () => {
    const { session } = openTestSession();
    const conversationId = await createConversation(session);
    const taskId = await createTask(session, conversationId);
    await session.commitWith(async (tx) => {
      const task = (await tx.task(taskId))!;
      tx.setTask(task);
      await expect(tx.task(taskId)).rejects.toBeInstanceOf(ReadAfterWrite);
    }, context);
  });
});

describe("Session transaction tables", () => {
  it("creates conversations, entries, and tasks with minted IDs", async () => {
    const { session, storage, publications, created } = await distinctMintedRecords();
    expect(created.headed.head).toBe(created.headed.id);
    expect(created.first).toEqual({
      id: created.first.id,
      conversationId: created.conversation.id,
      kind: "note",
      data: "one",
    });
    expect((await storage.entry(created.headed.id, context))!.entry).toEqual(created.headed);
    expect(await storage.task(created.task, context)).toEqual({
      id: created.task,
      conversationId: created.conversation.id,
      kind: "test.work",
      version: 1,
      input: { path: "x" },
      background: true,
      abortRequested: false,
      state: { status: "pending", checkpoint: { phase: "start" } },
    });
    await flush();
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
    await expect(
      session.commit(
        (tx) => tx.createTask(WorkTask, { path: "x" }, { ownership: { kind: "conversation" } }),
        context,
      ),
    ).rejects.toThrow("requires options.conversationId");
    await expect(
      session.commit(
        (tx) => tx.appendEntry(idFromNumber<ConversationId>(12345), { kind: "note" }),
        context,
      ),
    ).rejects.toThrow("Conversation 12345 does not exist");
  });
});

describe("Session transaction tables", () => {
  it("creates a conversation with an explicitly staged task owner", async () => {
    const { session, storage } = openTestSession();
    const parentId = await createConversation(session);
    const created = await session.commit(async (tx) => {
      const supervisorId = await tx.createTask(
        WorkTask,
        { path: "background" },
        { ownership: { kind: "conversation" }, conversationId: parentId, background: true },
      );
      const child = await tx.createConversation({
        ownership: { kind: "task", taskId: supervisorId },
      });
      return { supervisorId, child };
    }, context);

    expect(created.child.owner).toEqual({ conversationId: parentId, taskId: created.supervisorId });
    expect(await storage.conversation(created.child.id, context)).toEqual(created.child);

    await expect(
      session.commitWith(async (tx) => {
        const supervisor = (await tx.task(created.supervisorId))!;
        tx.setTask({ ...supervisor, conversationId: created.child.id });
      }, context),
    ).rejects.toThrow(`Task ${created.supervisorId} cannot change conversations`);
    expect((await storage.task(created.supervisorId, context))?.conversationId).toBe(parentId);
  });
});
