import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import storageConformanceSupport from "./storage-conformance-support.ts";
import type storageConformanceSupportTypes from "./storage-conformance-support.types.ts";

const { commit, createRoot, documentAt, failureOf, mint } = storageConformanceSupport;

const copiedRows = { count: 2, rows: [{ value: "base" }, { value: "current" }] };

const seedCopySource = Effect.fnUntraced(function* (storage: typesModule.Storage) {
  const rootId = yield* createRoot(storage);
  const childId = yield* mint<typesModule.ConversationId>(storage);
  const secondChildId = yield* mint<typesModule.ConversationId>(storage);
  yield* commit(storage, [
    { type: "conversation", value: { id: childId } },
    { type: "conversation", value: { id: secondChildId } },
  ]);
  const sourceId = yield* mint<typesModule.DocumentId>(storage);
  const sourceRecord = {
    fork: "asOf",
    history: "rewindable",
    id: sourceId,
    kind: "copy.source",
    scope: { conversationId: rootId, kind: "conversation" },
  } satisfies typesModule.DocumentCreate;
  const createdAt = yield* commit(storage, [
    {
      content: { kind: "base", value: { count: 1, rows: [{ value: "base" }] }, version: 2 },
      record: sourceRecord,
      type: "document.create",
    },
  ]);
  yield* commit(storage, [
    {
      content: {
        kind: "delta",
        ops: [
          ["s", ["count"], 2],
          ["p", ["rows"], 1, 0, [{ value: "current" }]],
        ],
        version: 2,
      },
      id: sourceId,
      type: "document.change",
    },
  ]);
  const childRecord = (
    id: typesModule.DocumentId,
    conversationId: typesModule.ConversationId,
  ): typesModule.DocumentCreate => ({
    fork: "asOf",
    history: "rewindable",
    id,
    kind: sourceRecord.kind,
    scope: { conversationId, kind: "conversation" },
  });
  return { childId, childRecord, createdAt, rootId, secondChildId, sourceId };
});

type CopySource = Effect.Success<ReturnType<typeof seedCopySource>>;

const copyBases = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  { rootId, childId, secondChildId, sourceId, createdAt, childRecord }: CopySource,
) {
  const historicalCopyId = yield* mint<typesModule.DocumentId>(storage);
  const currentCopyId = yield* mint<typesModule.DocumentId>(storage);
  const retiredCopyId = yield* mint<typesModule.DocumentId>(storage);
  const current = { at: "current", id: sourceId } as const;
  yield* commit(storage, [
    {
      record: childRecord(historicalCopyId, childId),
      source: { at: createdAt, id: sourceId },
      type: "document.copy",
    },
    { record: childRecord(currentCopyId, secondChildId), source: current, type: "document.copy" },
    { record: childRecord(retiredCopyId, rootId), source: current, type: "document.copy" },
    { id: retiredCopyId, type: "document.retire" },
  ]);
  expect(yield* documentAt(storage, historicalCopyId, "current")).toMatchObject({
    value: { count: 1, rows: [{ value: "base" }] },
    version: 2,
  });
  expect(yield* documentAt(storage, currentCopyId, "current")).toMatchObject({
    value: copiedRows,
    version: 2,
  });
  expect(yield* documentAt(storage, retiredCopyId, "current")).toBeUndefined();
  yield* commit(storage, [
    {
      content: { kind: "base", value: { count: 99, rows: [] }, version: 2 },
      id: sourceId,
      type: "document.change",
    },
    { id: sourceId, type: "document.retire" },
  ]);
  expect((yield* documentAt(storage, currentCopyId, "current"))?.value).toEqual(copiedRows);
  return currentCopyId;
});

const copyLatest = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  { rootId, childId }: CopySource,
) {
  const latestSourceId = yield* mint<typesModule.DocumentId>(storage);
  const latestCopyId = yield* mint<typesModule.DocumentId>(storage);
  const latestSource = {
    fork: "current",
    history: "latest",
    id: latestSourceId,
    kind: "copy.latest",
    scope: { conversationId: rootId, kind: "conversation" },
  } satisfies typesModule.DocumentCreate;
  yield* commit(storage, [
    {
      content: { kind: "base", value: { retained: "copy" }, version: 4 },
      record: latestSource,
      type: "document.create",
    },
  ]);
  yield* commit(storage, [
    {
      record: {
        ...latestSource,
        id: latestCopyId,
        scope: { conversationId: childId, kind: "conversation" },
      },
      source: { at: "current", id: latestSourceId },
      type: "document.copy",
    },
  ]);
  yield* commit(storage, [
    {
      content: { kind: "base", value: { retained: "source-only" }, version: 4 },
      id: latestSourceId,
      type: "document.change",
    },
    { id: latestSourceId, type: "document.retire" },
  ]);
  expect(yield* documentAt(storage, latestCopyId, "current")).toMatchObject({
    value: { retained: "copy" },
    version: 4,
  });
});

const rejectAmbiguousCopies = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  { childId, childRecord }: CopySource,
  currentCopyId: typesModule.DocumentId,
) {
  const source = { at: "current", id: currentCopyId } as const;
  const conflictId = yield* mint<typesModule.DocumentId>(storage);
  const conflictError = yield* failureOf(
    commit(storage, [
      { record: childRecord(conflictId, childId), source, type: "document.copy" },
      { id: currentCopyId, type: "document.retire" },
    ]),
  );
  expect(conflictError instanceof Error).toBe(true);
  expect(yield* documentAt(storage, conflictId, "current")).toBeUndefined();
  expect((yield* documentAt(storage, currentCopyId, "current"))?.value).toEqual(copiedRows);

  const mismatchId = yield* mint<typesModule.DocumentId>(storage);
  const mismatchError = yield* failureOf(
    commit(storage, [
      {
        record: { ...childRecord(mismatchId, childId), kind: "copy.mismatch" },
        source,
        type: "document.copy",
      },
    ]),
  );
  expect(mismatchError instanceof Error).toBe(true);
  expect(yield* documentAt(storage, mismatchId, "current")).toBeUndefined();
});

const copiedBases: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "copies stored document bases independently and rejects ambiguous sources",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const source = yield* seedCopySource(storage);
      const currentCopyId = yield* copyBases(storage, expect, source);
      yield* copyLatest(storage, expect, source);
      yield* rejectAmbiguousCopies(storage, expect, source, currentCopyId);
    }),
};

const documentsCopyCases: readonly storageConformanceSupportTypes.StorageCaseSpec[] = [copiedBases];

const storageConformanceDocumentsCopy = {
  documentsCopyCases,
};

export default storageConformanceDocumentsCopy;
