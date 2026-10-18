import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";

import type {
  ConversationId,
  DocumentCreate,
  DocumentId,
  EntryId,
  Storage,
  SubmissionId,
  SubmissionRecord,
  TaskId,
} from "../types.ts";
import {
  commit,
  context,
  createRoot,
  documentAt,
  entry,
  type Expect,
  io,
  mint,
  pendingTask,
  type StorageCaseSpec,
} from "./storage-conformance-support.ts";

const rejectSecondIncarnation = Effect.fnUntraced(function* (storage: Storage, expect: Expect) {
  const firstId = yield* mint<DocumentId>(storage);
  const secondId = yield* mint<DocumentId>(storage);
  const record = {
    id: firstId,
    kind: "singleton",
    scope: { kind: "session" },
  } satisfies DocumentCreate;
  yield* commit(storage, [
    { type: "document.create", record, content: { kind: "base", version: 1, value: { value: 1 } } },
  ]);
  yield* expect(
    storage.commit(
      [
        {
          type: "document.create",
          record: { ...record, id: secondId },
          content: { kind: "base", version: 1, value: { value: 2 } },
        },
        { type: "document.change", id: firstId, content: { kind: "delta", version: 1, ops: [] } },
      ],
      context,
    ),
  ).rejects.toThrow("already has a current incarnation");
  expect((yield* documentAt(storage, firstId, "current"))?.value).toEqual({ value: 1 });
  expect(yield* documentAt(storage, secondId, "current")).toBeUndefined();
  return record.kind;
});

const expectEmptyLifetime = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  rootId: ConversationId,
  kind: string,
) {
  const emptyId = yield* mint<DocumentId>(storage);
  const scope = { kind: "conversation", conversationId: rootId } as const;
  const emptyAt = yield* commit(storage, [
    {
      type: "document.create",
      record: { id: emptyId, kind, key: "empty", scope, history: "rewindable", fork: "initial" },
      content: { kind: "base", version: 1, value: {} },
    },
    { type: "document.retire", id: emptyId },
  ]);
  expect(yield* documentAt(storage, emptyId, "current")).toBeUndefined();
  expect(yield* documentAt(storage, emptyId, emptyAt)).toBeUndefined();
  expect(
    yield* io(() => storage.findDocument({ kind, scope, key: "empty" }, emptyAt, context)),
  ).toBeUndefined();
});

const lifecycleFailures: StorageCaseSpec = {
  name: "keeps document lifecycle failures atomic and gives create-plus-retire an empty lifetime",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const rootId = yield* createRoot(storage);
      const kind = yield* rejectSecondIncarnation(storage, expect);
      yield* expectEmptyLifetime(storage, expect, rootId, kind);
    }),
};

const seedAtomic = Effect.fnUntraced(function* (storage: Storage) {
  const rootId = yield* createRoot(storage);
  const taskId = yield* mint<TaskId<JsonValue>>(storage);
  const submissionId = yield* mint<SubmissionId>(storage);
  const documentId = yield* mint<DocumentId>(storage);
  const task = pendingTask(taskId, rootId);
  const submission: SubmissionRecord = {
    id: submissionId,
    conversationId: rootId,
    requestId: "atomic",
    type: "input",
    status: "queued",
  };
  const record = {
    id: documentId,
    kind: "atomic",
    scope: { kind: "session" },
  } satisfies DocumentCreate;
  const baselineSeq = yield* commit(storage, [
    { type: "task", value: task },
    { type: "submission", value: submission },
    { type: "document.create", record, content: { kind: "base", version: 1, value: { count: 1 } } },
  ]);
  return { rootId, task, submission, record, baselineSeq };
});

type Atomic = Effect.Success<ReturnType<typeof seedAtomic>>;

const expectRolledBack = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  { rootId, task, submission, record }: Atomic,
  entryId: EntryId,
  conflictingDocumentId: DocumentId,
) {
  expect(yield* io(() => storage.task(task.id, context))).toEqual(task);
  expect(
    (yield* io(() => storage.scanTasks({ status: "pending" }, 10, undefined, context))).items,
  ).toEqual([task]);
  expect(yield* io(() => storage.submissionByRequest(rootId, "atomic", context))).toEqual(
    submission,
  );
  expect(yield* io(() => storage.entry(entryId, context))).toBeUndefined();
  expect(yield* documentAt(storage, conflictingDocumentId, "current")).toBeUndefined();
  expect(
    (yield* io(() =>
      storage.findDocument({ kind: record.kind, scope: record.scope }, "current", context),
    ))?.id,
  ).toBe(record.id);
});

const rollbackIndexes: StorageCaseSpec = {
  name: "rolls back record tables and secondary indexes when a document command fails",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const atomic = yield* seedAtomic(storage);
      const { rootId, task, submission, record } = atomic;
      const entryId = yield* mint<EntryId>(storage);
      const conflictingDocumentId = yield* mint<DocumentId>(storage);
      yield* expect(
        storage.commit(
          [
            {
              type: "task",
              value: { ...task, state: { status: "running", checkpoint: { phase: "effect" } } },
            },
            {
              type: "submission",
              value: { ...submission, status: "unanswered", reason: "failed" },
            },
            { type: "entry", value: entry(entryId, rootId, "transient") },
            {
              type: "document.create",
              record: { ...record, id: conflictingDocumentId },
              content: { kind: "base", version: 1, value: { count: 2 } },
            },
          ],
          context,
        ),
      ).rejects.toThrow("already has a current incarnation");
      yield* expectRolledBack(storage, expect, atomic, entryId, conflictingDocumentId);
      const afterRollbackSeq = yield* commit(storage, [
        {
          type: "document.change",
          id: record.id,
          content: { kind: "delta", version: 1, ops: [["s", ["count"], 3]] },
        },
      ]);
      expect(afterRollbackSeq).toBeGreaterThan(atomic.baselineSeq);
    }),
};

export const documentsAtomicCases: readonly StorageCaseSpec[] = [
  lifecycleFailures,
  rollbackIndexes,
];
