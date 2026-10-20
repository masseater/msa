import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import storageConformanceSupport from "./storage-conformance-support.ts";
import type storageConformanceSupportTypes from "./storage-conformance-support.types.ts";

const { commit, context, createRoot, documentAt, entry, io, mint, pendingTask } =
  storageConformanceSupport;

const rejectSecondIncarnation = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
) {
  const firstId = yield* mint<typesModule.DocumentId>(storage);
  const secondId = yield* mint<typesModule.DocumentId>(storage);
  const record = {
    id: firstId,
    kind: "singleton",
    scope: { kind: "session" },
  } satisfies typesModule.DocumentCreate;
  yield* commit(storage, [
    { content: { kind: "base", value: { value: 1 }, version: 1 }, record, type: "document.create" },
  ]);
  yield* expect(
    storage.commit(
      [
        {
          content: { kind: "base", value: { value: 2 }, version: 1 },
          record: { ...record, id: secondId },
          type: "document.create",
        },
        { content: { kind: "delta", ops: [], version: 1 }, id: firstId, type: "document.change" },
      ],
      context,
    ),
  ).rejects.toThrow("already has a current incarnation");
  expect((yield* documentAt(storage, firstId, "current"))?.value).toEqual({ value: 1 });
  expect(yield* documentAt(storage, secondId, "current")).toBeUndefined();
  return record.kind;
});

const expectEmptyLifetime = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  rootId: typesModule.ConversationId,
  kind: string,
) {
  const emptyId = yield* mint<typesModule.DocumentId>(storage);
  const scope = { conversationId: rootId, kind: "conversation" } as const;
  const emptyAt = yield* commit(storage, [
    {
      content: { kind: "base", value: {}, version: 1 },
      record: { fork: "initial", history: "rewindable", id: emptyId, key: "empty", kind, scope },
      type: "document.create",
    },
    { id: emptyId, type: "document.retire" },
  ]);
  expect(yield* documentAt(storage, emptyId, "current")).toBeUndefined();
  expect(yield* documentAt(storage, emptyId, emptyAt)).toBeUndefined();
  expect(
    yield* io(() => storage.findDocument({ key: "empty", kind, scope }, emptyAt, context)),
  ).toBeUndefined();
});

const lifecycleFailures: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "keeps document lifecycle failures atomic and gives create-plus-retire an empty lifetime",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const rootId = yield* createRoot(storage);
      const kind = yield* rejectSecondIncarnation(storage, expect);
      yield* expectEmptyLifetime(storage, expect, rootId, kind);
    }),
};

const seedAtomic = Effect.fnUntraced(function* (storage: typesModule.Storage) {
  const rootId = yield* createRoot(storage);
  const taskId = yield* mint<typesModule.TaskId<JsonValue>>(storage);
  const submissionId = yield* mint<typesModule.SubmissionId>(storage);
  const documentId = yield* mint<typesModule.DocumentId>(storage);
  const task = pendingTask(taskId, rootId);
  const submission: typesModule.SubmissionRecord = {
    conversationId: rootId,
    id: submissionId,
    requestId: "atomic",
    status: "queued",
    type: "input",
  };
  const record = {
    id: documentId,
    kind: "atomic",
    scope: { kind: "session" },
  } satisfies typesModule.DocumentCreate;
  const baselineSeq = yield* commit(storage, [
    { type: "task", value: task },
    { type: "submission", value: submission },
    { content: { kind: "base", value: { count: 1 }, version: 1 }, record, type: "document.create" },
  ]);
  return { baselineSeq, record, rootId, submission, task };
});

type Atomic = Effect.Success<ReturnType<typeof seedAtomic>>;

const expectRolledBack = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  { rootId, task, submission, record }: Atomic,
  entryId: typesModule.EntryId,
  conflictingDocumentId: typesModule.DocumentId,
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

const rollbackIndexes: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "rolls back record tables and secondary indexes when a document command fails",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const atomic = yield* seedAtomic(storage);
      const { rootId, task, submission, record } = atomic;
      const entryId = yield* mint<typesModule.EntryId>(storage);
      const conflictingDocumentId = yield* mint<typesModule.DocumentId>(storage);
      yield* expect(
        storage.commit(
          [
            {
              type: "task",
              value: { ...task, state: { checkpoint: { phase: "effect" }, status: "running" } },
            },
            {
              type: "submission",
              value: { ...submission, reason: "failed", status: "unanswered" },
            },
            { type: "entry", value: entry(entryId, rootId, "transient") },
            {
              content: { kind: "base", value: { count: 2 }, version: 1 },
              record: { ...record, id: conflictingDocumentId },
              type: "document.create",
            },
          ],
          context,
        ),
      ).rejects.toThrow("already has a current incarnation");
      yield* expectRolledBack(storage, expect, atomic, entryId, conflictingDocumentId);
      const afterRollbackSeq = yield* commit(storage, [
        {
          content: { kind: "delta", ops: [["s", ["count"], 3]], version: 1 },
          id: record.id,
          type: "document.change",
        },
      ]);
      expect(afterRollbackSeq).toBeGreaterThan(atomic.baselineSeq);
    }),
};

const documentsAtomicCases: readonly storageConformanceSupportTypes.StorageCaseSpec[] = [
  lifecycleFailures,
  rollbackIndexes,
];

const storageConformanceDocumentsAtomic = {
  documentsAtomicCases,
};

export default storageConformanceDocumentsAtomic;
