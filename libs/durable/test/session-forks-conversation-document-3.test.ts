import { defineDoc, defineDocFamily, defineTask, type EntryId, type TaskId } from "@msa/durable";
import { describe, expect, it } from "vite-plus/test";

import { documentCopies } from "./session-forks-support.ts";
import {
  context,
  createConversation,
  documentCopyChanges,
  flush,
  openTestSession,
} from "./session-support.ts";

function scopedDocsAndWork() {
  const Copied = defineDoc<{ value: string }>({
    kind: "fork.scope.conversation",
    version: 1,
    scope: "conversation",
    history: "latest",
    fork: "current",
    initial: () => ({ value: "conversation" }),
  });
  const SessionOnly = defineDoc<{ value: string }>({
    kind: "fork.scope.session",
    version: 1,
    scope: "session",
    initial: () => ({ value: "session" }),
  });
  const TaskOnly = defineDoc<{ value: string }>({
    kind: "fork.scope.task",
    version: 1,
    scope: "task",
    initial: () => ({ value: "task" }),
  });
  const Work = defineTask<null, { phase: "start" }, null>({
    name: "fork.scope.work",
    version: 1,
    initial: () => ({ phase: "start" }),
    phases: { start: async () => {} },
    abort: async () => {},
  });
  return { Copied, SessionOnly, TaskOnly, Work };
}

describe("Session conversation document forks", () => {
  it("copies only conversation documents, leaving Session and task documents in their original scopes", async () => {
    const { Copied, SessionOnly, TaskOnly, Work } = scopedDocsAndWork();
    const { session, storage, publications } = openTestSession();
    const parentId = await createConversation(session);
    let forkAt!: EntryId;
    let taskId!: TaskId;
    await session.commit(async (tx) => {
      forkAt = (await tx.appendEntry(parentId, { kind: "point" })).id;
      taskId = await tx.createTask(Work, null, {
        ownership: { kind: "conversation" },
        conversationId: parentId,
      });
      await tx.doc(Copied, parentId);
      await tx.doc(SessionOnly);
      await tx.doc(TaskOnly, taskId);
    }, context);
    const child = await session.commit(
      (tx) => tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
      context,
    );
    await flush();
    const copies = documentCopies(storage.commits.at(-1)!);
    expect(copies.map((write) => write.record.kind)).toEqual([Copied.definition.kind]);
    expect(documentCopyChanges(publications.at(-1)!).map((change) => change.record.kind)).toEqual([
      Copied.definition.kind,
    ]);
    expect(await session.snapshot(Copied, child.id, context)).toEqual({ value: "conversation" });
    expect(await session.snapshot(SessionOnly, context)).toEqual({ value: "session" });
    expect(await session.snapshot(TaskOnly, taskId, context)).toEqual({ value: "task" });
  });
});

describe("Session conversation document forks", () => {
  it("copies every family member across storage scan pages", async () => {
    const Family = defineDocFamily<{ value: number }, number>({
      kind: "fork.pagination",
      version: 1,
      family: true,
      scope: "conversation",
      history: "latest",
      fork: "current",
      initial: (seed) => ({ value: seed }),
    });
    const { session, storage } = openTestSession();
    const parentId = await createConversation(session);
    const forkAt = await session.commit(
      async (tx) => (await tx.appendEntry(parentId, { kind: "point" })).id,
      context,
    );
    await session.commit(async (tx) => {
      await Promise.all(
        Array.from({ length: 260 }, async (_, index) => {
          await tx.doc(Family, parentId, `member-${index}`, index);
        }),
      );
    }, context);
    const child = await session.commit(
      (tx) => tx.forkConversation(parentId, forkAt, { ownership: { kind: "ownerless" } }),
      context,
    );
    expect(documentCopies(storage.commits.at(-1)!)).toHaveLength(260);
    expect(await session.snapshot(Family, child.id, "member-0", context)).toEqual({ value: 0 });
    expect(await session.snapshot(Family, child.id, "member-259", context)).toEqual({ value: 259 });
  });
});
