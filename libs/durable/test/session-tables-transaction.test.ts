import { type ConversationId, type TaskId } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import {
  context,
  createConversation,
  documentChanges,
  flush,
  openTestSession,
} from "./session-support.ts";
import { WorkTask, createTask, ProgressDoc, StepDoc, terminal } from "./session-tables-support.ts";

async function expectMissingOwnerRejected(session: ReturnType<typeof openTestSession>["session"]) {
  const missingTaskId = idFromNumber<TaskId>(999);
  await expect(
    session.commit(
      (tx) => tx.createConversation({ ownership: { kind: "task", taskId: missingTaskId } }),
      context,
    ),
  ).rejects.toThrow("Conversation owner task 999 does not exist");
}

async function expectAbortMarkedOwnerRejected(
  session: ReturnType<typeof openTestSession>["session"],
  storage: ReturnType<typeof openTestSession>["storage"],
  parentId: ConversationId,
) {
  let rejectedChildId: ConversationId | undefined;
  await expect(
    session.commitWith(async (tx) => {
      const supervisorId = await tx.createTask(
        WorkTask,
        { path: "aborting" },
        { ownership: { kind: "conversation" }, conversationId: parentId },
      );
      rejectedChildId = (
        await tx.createConversation({ ownership: { kind: "task", taskId: supervisorId } })
      ).id;
      tx.setTask({
        id: supervisorId,
        conversationId: parentId,
        kind: WorkTask.definition.name,
        version: WorkTask.definition.version,
        input: { path: "aborting" },
        background: false,
        abortRequested: true,
        state: { status: "pending", checkpoint: { phase: "start" } },
      });
    }, context),
  ).rejects.toThrow("is abort-marked");
  expect(rejectedChildId).toBeDefined();
  if (rejectedChildId === undefined) throw new Error("Expected a rejected child ID");
  expect(await storage.conversation(rejectedChildId, context)).toBeUndefined();
}

async function expectTerminalOwnerRejected(
  session: ReturnType<typeof openTestSession>["session"],
  parentId: ConversationId,
) {
  await expect(
    session.commitWith(async (tx) => {
      const supervisorId = await tx.createTask(
        WorkTask,
        { path: "terminal" },
        { ownership: { kind: "conversation" }, conversationId: parentId },
      );
      await tx.createConversation({ ownership: { kind: "task", taskId: supervisorId } });
      tx.setTask({
        id: supervisorId,
        conversationId: parentId,
        kind: WorkTask.definition.name,
        version: WorkTask.definition.version,
        input: { path: "terminal" },
        background: false,
        abortRequested: false,
        state: { status: "terminal", outcome: { status: "completed", result: { ok: true } } },
      });
    }, context),
  ).rejects.toThrow("is terminal");
}

async function expectCommittedTerminalOwnerRejected(
  session: ReturnType<typeof openTestSession>["session"],
  parentId: ConversationId,
) {
  const terminalOwnerId = await createTask(session, parentId);
  await session.commitWith(async (tx) => {
    tx.setTask(terminal((await tx.task(terminalOwnerId))!));
  }, context);
  await expect(
    session.commit(
      (tx) => tx.createConversation({ ownership: { kind: "task", taskId: terminalOwnerId } }),
      context,
    ),
  ).rejects.toThrow("is terminal");
}

describe("Session transaction tables", () => {
  it("rejects missing, terminal, and abort-marked conversation owners atomically", async () => {
    const { session, storage } = openTestSession();
    const parentId = await createConversation(session);
    let movedStagedTaskId: TaskId<{ ok: boolean }> | undefined;
    await expect(
      session.commitWith(async (tx) => {
        const taskId = await tx.createTask(
          WorkTask,
          { path: "move" },
          { ownership: { kind: "conversation" }, conversationId: parentId },
        );
        movedStagedTaskId = taskId;
        tx.setTask({
          id: taskId,
          conversationId: idFromNumber<ConversationId>(998),
          kind: WorkTask.definition.name,
          version: WorkTask.definition.version,
          input: { path: "move" },
          background: false,
          abortRequested: false,
          state: { status: "pending", checkpoint: { phase: "start" } },
        });
      }, context),
    ).rejects.toThrow("cannot change conversations");
    if (movedStagedTaskId === undefined) throw new Error("Expected a staged task ID");
    expect(await storage.task(movedStagedTaskId, context)).toBeUndefined();
    await expectMissingOwnerRejected(session);
    await expectAbortMarkedOwnerRejected(session, storage, parentId);
    await expectTerminalOwnerRejected(session, parentId);
    await expectCommittedTerminalOwnerRejected(session, parentId);
  });
});

describe("Session transaction tables", () => {
  it("takes ownership of table JSON and rejects non-strict values", async () => {
    const { session, storage } = openTestSession();
    const conversationId = await createConversation(session);
    const payload = { nested: { value: 1 } };
    const entry = await session.commit(async (tx) => {
      const created = await tx.appendEntry(conversationId, { kind: "data", data: payload });
      payload.nested.value = 2;
      return created;
    }, context);
    expect((await storage.entry(entry.id, context))!.entry.data).toEqual({ nested: { value: 1 } });
    const omitted = await session.commit(
      (tx) => tx.appendEntry(conversationId, { kind: "omitted", data: undefined }),
      context,
    );
    expect(Object.hasOwn(omitted, "data")).toBe(false);
    expect(Object.hasOwn((await storage.entry(omitted.id, context))!.entry, "data")).toBe(false);

    const commits = storage.commits.length;
    await expect(
      session.commit(
        (tx) =>
          tx
            .appendEntry(conversationId, { kind: "invalid", data: Number.NaN })
            .then(() => undefined),
        context,
      ),
    ).rejects.toThrow("strict JSON");
    expect(storage.commits.length).toBe(commits);
  });
});

describe("Session transaction tables", () => {
  it("replaces task records completely", async () => {
    const { session, storage } = openTestSession();
    const conversationId = await createConversation(session);
    const taskId = await createTask(session, conversationId);
    await session.commitWith(async (tx) => {
      const task = (await tx.task(taskId))!;
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
    }, context);
    expect(await storage.task(taskId, context)).toMatchObject({
      state: { status: "running", checkpoint: { phase: "next", step: 2 } },
      memos: { choice: "b" },
    });
  });
});

describe("Session transaction tables", () => {
  it("creates a task and then its document in one transaction without ReadAfterWrite", async () => {
    const { session, publications } = openTestSession();
    const conversationId = await createConversation(session);
    const taskId = await session.commit(async (tx) => {
      const createdTaskId = await tx.createTask(
        WorkTask,
        { path: "a" },
        { ownership: { kind: "conversation" }, conversationId },
      );
      // Validation uses the candidate task record, not a caller table read.
      (await tx.doc(ProgressDoc, createdTaskId)).lines.push("created");
      (await tx.doc(StepDoc, createdTaskId, "one", null)).lines.push("step");
      return createdTaskId;
    }, context);
    expect(await session.snapshot(ProgressDoc, taskId, context)).toEqual({ lines: ["created"] });
    await flush();
    const publication = publications.at(-1)!;
    const documents = documentChanges(publication);
    expect(publication.changes).toContainEqual(
      expect.objectContaining({ type: "task", value: expect.objectContaining({ id: taskId }) }),
    );
    expect(documents).toHaveLength(2);
    // Task documents derive their conversation from the task record.
    for (const document of documents) expect(document.conversationId).toBe(conversationId);

    await session.commit(async (tx) => {
      await tx.createConversation({ ownership: { kind: "ownerless" } });
      (await tx.doc(ProgressDoc, taskId)).lines.push("committed task");
    }, context);
    await flush();
    expect(documentChanges(publications.at(-1)!)[0]!.conversationId).toBe(conversationId);
  });
});

describe("Session transaction tables", () => {
  it("rejects task documents after a terminal candidate", async () => {
    const { session } = openTestSession();
    const conversationId = await createConversation(session);
    const taskId = await createTask(session, conversationId, true);
    await session.commitWith(async (tx) => {
      const task = (await tx.task(taskId))!;
      const progress = await tx.doc(ProgressDoc, taskId);
      tx.setTask(terminal(task));
      await expect(tx.doc(ProgressDoc, taskId)).rejects.toThrow(`Task ${taskId} is terminal`);
      await expect(tx.doc(StepDoc, taskId, "late", null)).rejects.toThrow(
        `Task ${taskId} is terminal`,
      );
      expect(() => tx.setTask(task)).toThrow("terminal candidate");
      progress.lines.push("final");
    }, context);
    await expect(
      session.commit((tx) => tx.doc(ProgressDoc, taskId).then(() => undefined), context),
    ).rejects.toThrow(`Task ${taskId} is terminal`);
  });
});
