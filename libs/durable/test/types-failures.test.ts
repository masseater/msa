import { expectTypeOf, it } from "vite-plus/test";

import type durableTypes from "../src/index.types.ts";
import type typeSupportTypes from "./type-support.ts";
import typesIds from "./types-ids.ts";

const { conversationId, documentId, entryId, seq, submissionId, taskId } = typesIds;

type Entry = typeof entryId;
type Live = { phase: string };

function contextEditFailures() {
  expectTypeOf<
    typeSupportTypes.LiteralFits<{ target: Entry; action: "replace" }, durableTypes.ContextEdit>
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      { target: Entry; action: "omit"; messages: [] },
      durableTypes.ContextEdit
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<{ target: Entry; action: "omit" }, durableTypes.ContextEdit>
  >().toEqualTypeOf<true>();
}

function taskStateFailures() {
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      {
        status: "pending";
        checkpoint: { phase: "ready" };
        outcome: { status: "completed"; result: 1 };
      },
      durableTypes.TaskState<Live, number>
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      {
        status: "terminal";
        checkpoint: { phase: "ready" };
        outcome: { status: "completed"; result: 1 };
      },
      durableTypes.TaskState<Live, number>
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      { status: "terminal"; outcome: { status: "completed"; result: 1 } },
      durableTypes.TaskState<Live, number>
    >
  >().toEqualTypeOf<true>();
}

function taskRecordFailures() {
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
    typeSupportTypes.LiteralFits<
      TerminalRecord & { memos: { retained: true } },
      durableTypes.TaskRecord<null, Live, number>
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<TerminalRecord, durableTypes.TaskRecord<null, Live, number>>
  >().toEqualTypeOf<true>();
}

function documentRecordFailures() {
  type Document = typeof documentId;
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      {
        id: Document;
        kind: "test";
        createdAt: typeof seq;
        scope: { kind: "session" };
        history: "latest";
        fork: "current";
      },
      durableTypes.DocumentRecord
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      { id: Document; kind: "test"; createdAt: typeof seq; scope: { kind: "session" } },
      durableTypes.DocumentRecord
    >
  >().toEqualTypeOf<true>();
}

function documentCreateFailures() {
  type Document = typeof documentId;
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      {
        id: Document;
        kind: "test";
        scope: { kind: "conversation"; conversationId: typeof conversationId };
      },
      durableTypes.DocumentCreate
    >
  >().toEqualTypeOf<false>();
  const taskWithPolicy = {
    fork: "initial",
    history: "latest",
    id: documentId,
    kind: "test",
    scope: { kind: "task", taskId },
  } as const;
  expectTypeOf(taskWithPolicy).not.toExtend<durableTypes.DocumentCreate>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      { id: Document; kind: "test"; scope: { kind: "session" }; createdAt: typeof seq },
      durableTypes.DocumentCreate
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      { id: Document; kind: "test"; scope: { kind: "session" } },
      durableTypes.DocumentCreate
    >
  >().toEqualTypeOf<true>();
}

function documentContentFailures() {
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      { kind: "base"; version: 1; value: {}; ops: [] },
      durableTypes.DocumentContent
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      { kind: "delta"; version: 1; ops: []; value: {} },
      durableTypes.DocumentContent
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      { kind: "delta"; version: 1; ops: [] },
      durableTypes.DocumentContent
    >
  >().toEqualTypeOf<true>();
  type Created<Content> = {
    type: "document.create";
    record: { id: typeof documentId; kind: "test"; scope: { kind: "session" } };
    content: Content;
  };
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      Created<{ kind: "delta"; version: 1; ops: [] }>,
      durableTypes.StorageWrite
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      Created<{ kind: "base"; version: 1; value: {} }>,
      durableTypes.StorageWrite
    >
  >().toEqualTypeOf<true>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      { status: "completed"; result: 1; error: { message: "impossible" } },
      durableTypes.TaskOutcome<number>
    >
  >().toEqualTypeOf<false>();
}

function submissionRecordFailures() {
  type Base = { id: typeof submissionId; conversationId: typeof conversationId };
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      Base & { type: "input"; status: "queued"; entry: Entry },
      durableTypes.SubmissionRecord
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      Base & { type: "input"; status: "queued" },
      durableTypes.SubmissionRecord
    >
  >().toEqualTypeOf<true>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      Base & { type: "input"; status: "done"; entry: Entry },
      durableTypes.SubmissionRecord
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      Base & { type: "input"; status: "done"; entry: Entry; answer: Entry },
      durableTypes.SubmissionRecord
    >
  >().toEqualTypeOf<true>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      Base & { type: "write"; status: "done"; entry: Entry; answer: Entry },
      durableTypes.SubmissionRecord
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      {
        id: typeof submissionId;
        conversationId: typeof conversationId;
        type: "write";
        status: "queued";
      },
      durableTypes.SubmissionCreate
    >
  >().toEqualTypeOf<false>();
  expectTypeOf<
    typeSupportTypes.LiteralFits<
      { conversationId: typeof conversationId; type: "write"; status: "queued" },
      durableTypes.SubmissionCreate
    >
  >().toEqualTypeOf<true>();
}

it("rejects fields that do not belong to a discriminator", () => {
  contextEditFailures();
  taskStateFailures();
  taskRecordFailures();
  documentRecordFailures();
  documentCreateFailures();
  documentContentFailures();
  submissionRecordFailures();
});
