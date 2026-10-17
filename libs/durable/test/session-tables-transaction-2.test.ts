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
import { createTask, ProgressDoc, NotesDoc, StepDoc, terminal } from "./session-tables-support.ts";

describe("Session transaction tables", () => {
  it("retires task documents at terminal settlement, including documents created in the same transaction", async () => {
    const { session, storage, publications } = openTestSession();
    const conversationId = await createConversation(session);
    const taskId = await createTask(session, conversationId, true);
    await session.commit(async (tx) => {
      (await tx.doc(StepDoc, taskId, "committed", null)).lines.push("x");
    }, context);
    await flush();
    const published = publications.length;
    await session.commitWith(async (tx) => {
      const task = (await tx.task(taskId))!;
      (await tx.doc(StepDoc, taskId, "new", null)).lines.push("created then retired");
      tx.setTask(terminal(task));
    }, context);
    const writes = storage.commits.at(-1)!;
    expect(writes).toHaveLength(5);
    expect(writes.filter((write) => write.type === "task")).toHaveLength(1);
    const creations = writes.filter((write) => write.type === "document.create");
    const retirements = writes.filter((write) => write.type === "document.retire");
    expect(creations).toHaveLength(1);
    expect(retirements).toHaveLength(3);
    expect(retirements.map((write) => write.id)).toContain(creations[0]!.record.id);
    await flush();
    expect(publications.length).toBe(published + 1);
    const publication = publications.at(-1)!;
    const documents = documentChanges(publication);
    expect(publication.changes.filter((change) => change.type === "task")).toHaveLength(1);
    expect(documents.map((document) => document.value)).toEqual([null, null, null]);
    for (const document of documents) expect(document.ops).toEqual([]);
    for (const document of documents) expect(document.conversationId).toBe(conversationId);
    expect(await session.snapshot(ProgressDoc, taskId, context)).toBeUndefined();
    expect(await session.snapshot(StepDoc, taskId, "committed", context)).toBeUndefined();
    const alive = await storage.scanDocuments(
      { scope: { kind: "task", taskId }, at: "current" },
      10,
      undefined,
      context,
    );
    expect(alive.items).toEqual([]);
    await expect(
      session.commitWith(async (tx) => {
        tx.setTask(terminal((await tx.task(taskId))!));
      }, context),
    ).rejects.toThrow(`Task ${taskId} is already terminal`);
  });
});

describe("Session transaction tables", () => {
  it("validates document owners", async () => {
    const { session } = openTestSession();
    await expect(
      session.commit(
        (tx) => tx.doc(ProgressDoc, idFromNumber<TaskId>(4242)).then(() => undefined),
        context,
      ),
    ).rejects.toThrow("Task 4242 does not exist");
    await expect(
      session.commit(
        (tx) => tx.doc(NotesDoc, idFromNumber<ConversationId>(4242)).then(() => undefined),
        context,
      ),
    ).rejects.toThrow("Conversation 4242 does not exist");
  });
});
