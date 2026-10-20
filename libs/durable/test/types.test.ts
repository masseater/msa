import { expect, expectTypeOf, it } from "vite-plus/test";

import type {
  ContextEdit,
  ConversationId,
  DocumentContent,
  DocumentCreate,
  DocumentId,
  EntryId,
  SubmissionCreate,
  SubmissionRecord,
  TaskId,
  TaskState,
} from "../src/index.ts";
import typesIds from "./types-ids.ts";

const { answerId, conversationId, documentId, entryId, seq, submissionId, taskId } = typesIds;

type TaskResult<I> = I extends TaskId<infer R> ? R : never;

it("brands numeric IDs by record kind and carries task result types", () => {
  expect(typeof conversationId).toBe("number");
  expect(JSON.stringify(taskId)).toBe("4");
  expectTypeOf(conversationId).toMatchTypeOf<number>();
  expectTypeOf<TaskResult<typeof taskId>>().toEqualTypeOf<number>();

  expectTypeOf<TaskId>().not.toExtend<TaskId<string>>();
  expectTypeOf(conversationId).not.toExtend<TaskId>();
  expectTypeOf(taskId).not.toExtend<ConversationId>();
  expectTypeOf(entryId).not.toExtend<DocumentId>();
  expectTypeOf(entryId).not.toExtend<typeof seq>();
});

function expectEditAndStateDiscriminators() {
  const omit = { action: "omit", target: entryId } satisfies ContextEdit;
  const replace = { action: "replace", messages: [], target: entryId } satisfies ContextEdit;
  const pending = { checkpoint: { phase: "ready" }, status: "pending" } satisfies TaskState<
    { phase: string },
    { value: number }
  >;
  const terminal = {
    outcome: { result: { value: 1 }, status: "completed" },
    status: "terminal",
  } satisfies TaskState<{ phase: string }, { value: number }>;
  expectTypeOf(omit.action).toEqualTypeOf<"omit">();
  expectTypeOf(replace.action).toEqualTypeOf<"replace">();
  expectTypeOf(pending.status).toEqualTypeOf<"pending">();
  expectTypeOf(terminal.status).toEqualTypeOf<"terminal">();
}

function expectRecordDiscriminators() {
  const completedInput = {
    answer: answerId,
    conversationId,
    entry: entryId,
    id: submissionId,
    status: "done",
    type: "input",
  } satisfies SubmissionRecord;
  const completedWrite = {
    conversationId,
    entry: entryId,
    id: submissionId,
    status: "done",
    type: "write",
  } satisfies SubmissionRecord;
  const queuedWriteCreate = {
    conversationId,
    status: "queued",
    type: "write",
  } satisfies SubmissionCreate;
  const baseContent = { kind: "base", value: { count: 1 }, version: 1 } satisfies DocumentContent;
  const deltaContent = {
    kind: "delta",
    ops: [["s", ["count"], 2]],
    version: 1,
  } satisfies DocumentContent;
  const conversationDocument = {
    fork: "asOf",
    history: "rewindable",
    id: documentId,
    kind: "test",
    scope: { conversationId, kind: "conversation" },
  } satisfies DocumentCreate;
  expectTypeOf(completedInput.answer).toEqualTypeOf<EntryId>();
  expectTypeOf(completedWrite.type).toEqualTypeOf<"write">();
  expectTypeOf(queuedWriteCreate.status).toEqualTypeOf<"queued">();
  expectTypeOf(baseContent.kind).toEqualTypeOf<"base">();
  expectTypeOf(deltaContent.kind).toEqualTypeOf<"delta">();
  expectTypeOf(conversationDocument.fork).toEqualTypeOf<"asOf">();
}

it("encodes discriminator-dependent fields", () => {
  expectEditAndStateDiscriminators();
  expectRecordDiscriminators();
});
