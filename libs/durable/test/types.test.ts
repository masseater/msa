import { expect, expectTypeOf, it } from "vite-plus/test";

import { idFromNumber, seqFromNumber } from "../src/ids.ts";
import type {
  ContextEdit,
  ConversationId,
  DocumentContent,
  DocumentCreate,
  DocumentId,
  DocumentRecord,
  EntryId,
  StorageWrite,
  SubmissionCreate,
  SubmissionId,
  SubmissionRecord,
  TaskId,
  TaskOutcome,
  TaskRecord,
  TaskState,
} from "../src/index.ts";
import type { LiteralFits } from "./type-support.ts";

const conversationId = idFromNumber<ConversationId>(1);
const entryId = idFromNumber<EntryId>(2);
const answerId = idFromNumber<EntryId>(3);
const taskId = idFromNumber<TaskId<number>>(4);
const submissionId = idFromNumber<SubmissionId>(5);
const documentId = idFromNumber<DocumentId>(6);
const seq = seqFromNumber(1);

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
  const omit = { target: entryId, action: "omit" } satisfies ContextEdit;
  const replace = { target: entryId, action: "replace", messages: [] } satisfies ContextEdit;
  const pending = { status: "pending", checkpoint: { phase: "ready" } } satisfies TaskState<
    { phase: string },
    { value: number }
  >;
  const terminal = {
    status: "terminal",
    outcome: { status: "completed", result: { value: 1 } },
  } satisfies TaskState<{ phase: string }, { value: number }>;
  expectTypeOf(omit.action).toEqualTypeOf<"omit">();
  expectTypeOf(replace.action).toEqualTypeOf<"replace">();
  expectTypeOf(pending.status).toEqualTypeOf<"pending">();
  expectTypeOf(terminal.status).toEqualTypeOf<"terminal">();
}

function expectRecordDiscriminators() {
  const completedInput = {
    id: submissionId,
    conversationId,
    type: "input",
    status: "done",
    entry: entryId,
    answer: answerId,
  } satisfies SubmissionRecord;
  const completedWrite = {
    id: submissionId,
    conversationId,
    type: "write",
    status: "done",
    entry: entryId,
  } satisfies SubmissionRecord;
  const queuedWriteCreate = {
    conversationId,
    type: "write",
    status: "queued",
  } satisfies SubmissionCreate;
  const baseContent = { kind: "base", version: 1, value: { count: 1 } } satisfies DocumentContent;
  const deltaContent = {
    kind: "delta",
    version: 1,
    ops: [["s", ["count"], 2]],
  } satisfies DocumentContent;
  const conversationDocument = {
    id: documentId,
    kind: "test",
    scope: { kind: "conversation", conversationId },
    history: "rewindable",
    fork: "asOf",
  } satisfies DocumentCreate;
  expectTypeOf(completedInput.answer).toEqualTypeOf<EntryId>();
  expectTypeOf(completedWrite.type).toEqualTypeOf<"write">();
  expectTypeOf(queuedWriteCreate.status).toEqualTypeOf<"queued">();
  expectTypeOf(baseContent.kind).toEqualTypeOf<"base">();
  expectTypeOf(deltaContent.kind).toEqualTypeOf<"delta">();
  expectTypeOf(conversationDocument.fork).toEqualTypeOf<"asOf">();
}

type Entry = typeof entryId;
type Live = { phase: string };

function editAndTaskStateFailures() {
  expectTypeOf<
    LiteralFits<{ target: Entry; action: "replace" }, ContextEdit>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<{ target: Entry; action: "omit"; messages: [] }, ContextEdit>
  >().toEqualTypeOf<false>();
  expectTypeOf<LiteralFits<{ target: Entry; action: "omit" }, ContextEdit>>().toEqualTypeOf<true>();
  expectTypeOf<
    LiteralFits<
      {
        status: "pending";
        checkpoint: { phase: "ready" };
        outcome: { status: "completed"; result: 1 };
      },
      TaskState<Live, number>
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<
      {
        status: "terminal";
        checkpoint: { phase: "ready" };
        outcome: { status: "completed"; result: 1 };
      },
      TaskState<Live, number>
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<
      { status: "terminal"; outcome: { status: "completed"; result: 1 } },
      TaskState<Live, number>
    >
  >().toEqualTypeOf<true>();
  type TerminalRecord = {
    id: typeof taskId;
    conversationId: typeof conversationId;
    kind: "test";
    version: 1;
    input: null;
    state: { status: "terminal"; outcome: { status: "completed"; result: 1 } };
    background: false;
    abortRequested: false;
  };
  expectTypeOf<
    LiteralFits<TerminalRecord & { memos: { retained: true } }, TaskRecord<null, Live, number>>
  >().toEqualTypeOf<false>();
  expectTypeOf<LiteralFits<TerminalRecord, TaskRecord<null, Live, number>>>().toEqualTypeOf<true>();
}

function documentRecordFailures() {
  type Document = typeof documentId;
  expectTypeOf<
    LiteralFits<
      {
        id: Document;
        kind: "test";
        createdAt: typeof seq;
        scope: { kind: "session" };
        history: "latest";
        fork: "current";
      },
      DocumentRecord
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<
      { id: Document; kind: "test"; createdAt: typeof seq; scope: { kind: "session" } },
      DocumentRecord
    >
  >().toEqualTypeOf<true>();
  expectTypeOf<
    LiteralFits<
      {
        id: Document;
        kind: "test";
        scope: { kind: "conversation"; conversationId: typeof conversationId };
      },
      DocumentCreate
    >
  >().toEqualTypeOf<false>();
  const taskWithPolicy = {
    id: documentId,
    kind: "test",
    scope: { kind: "task", taskId },
    history: "latest",
    fork: "initial",
  } as const;
  expectTypeOf(taskWithPolicy).not.toExtend<DocumentCreate>();
  expectTypeOf<
    LiteralFits<
      { id: Document; kind: "test"; scope: { kind: "session" }; createdAt: typeof seq },
      DocumentCreate
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<{ id: Document; kind: "test"; scope: { kind: "session" } }, DocumentCreate>
  >().toEqualTypeOf<true>();
}

function documentContentFailures() {
  expectTypeOf<
    LiteralFits<{ kind: "base"; version: 1; value: {}; ops: [] }, DocumentContent>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<{ kind: "delta"; version: 1; ops: []; value: {} }, DocumentContent>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<{ kind: "delta"; version: 1; ops: [] }, DocumentContent>
  >().toEqualTypeOf<true>();
  type Created<Content> = {
    type: "document.create";
    record: { id: typeof documentId; kind: "test"; scope: { kind: "session" } };
    content: Content;
  };
  expectTypeOf<
    LiteralFits<Created<{ kind: "delta"; version: 1; ops: [] }>, StorageWrite>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<Created<{ kind: "base"; version: 1; value: {} }>, StorageWrite>
  >().toEqualTypeOf<true>();
  expectTypeOf<
    LiteralFits<
      { status: "completed"; result: 1; error: { message: "impossible" } },
      TaskOutcome<number>
    >
  >().toEqualTypeOf<false>();
}

function submissionRecordFailures() {
  type Base = { id: typeof submissionId; conversationId: typeof conversationId };
  expectTypeOf<
    LiteralFits<Base & { type: "input"; status: "queued"; entry: Entry }, SubmissionRecord>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<Base & { type: "input"; status: "queued" }, SubmissionRecord>
  >().toEqualTypeOf<true>();
  expectTypeOf<
    LiteralFits<Base & { type: "input"; status: "done"; entry: Entry }, SubmissionRecord>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<
      Base & { type: "input"; status: "done"; entry: Entry; answer: Entry },
      SubmissionRecord
    >
  >().toEqualTypeOf<true>();
  expectTypeOf<
    LiteralFits<
      Base & { type: "write"; status: "done"; entry: Entry; answer: Entry },
      SubmissionRecord
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<
      {
        id: typeof submissionId;
        conversationId: typeof conversationId;
        type: "write";
        status: "queued";
      },
      SubmissionCreate
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    LiteralFits<
      { conversationId: typeof conversationId; type: "write"; status: "queued" },
      SubmissionCreate
    >
  >().toEqualTypeOf<true>();
}

it("encodes discriminator-dependent fields", () => {
  expectEditAndStateDiscriminators();
  expectRecordDiscriminators();
  editAndTaskStateFailures();
  documentRecordFailures();
  documentContentFailures();
  submissionRecordFailures();
});
