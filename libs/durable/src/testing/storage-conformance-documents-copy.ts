import { Effect } from "effect";

import type { ConversationId, DocumentCreate, DocumentId, Storage } from "../types.ts";
import {
  commit,
  createRoot,
  documentAt,
  type Expect,
  failureOf,
  mint,
  type StorageCaseSpec,
} from "./storage-conformance-support.ts";

const copiedRows = { count: 2, rows: [{ value: "base" }, { value: "current" }] };

const seedCopySource = Effect.fnUntraced(function* (storage: Storage) {
  const rootId = yield* createRoot(storage);
  const childId = yield* mint<ConversationId>(storage);
  const secondChildId = yield* mint<ConversationId>(storage);
  yield* commit(storage, [
    { type: "conversation", value: { id: childId } },
    { type: "conversation", value: { id: secondChildId } },
  ]);
  const sourceId = yield* mint<DocumentId>(storage);
  const sourceRecord = {
    id: sourceId,
    kind: "copy.source",
    scope: { kind: "conversation", conversationId: rootId },
    history: "rewindable",
    fork: "asOf",
  } satisfies DocumentCreate;
  const createdAt = yield* commit(storage, [
    {
      type: "document.create",
      record: sourceRecord,
      content: { kind: "base", version: 2, value: { count: 1, rows: [{ value: "base" }] } },
    },
  ]);
  yield* commit(storage, [
    {
      type: "document.change",
      id: sourceId,
      content: {
        kind: "delta",
        version: 2,
        ops: [
          ["s", ["count"], 2],
          ["p", ["rows"], 1, 0, [{ value: "current" }]],
        ],
      },
    },
  ]);
  const childRecord = (id: DocumentId, conversationId: ConversationId): DocumentCreate => ({
    id,
    kind: sourceRecord.kind,
    scope: { kind: "conversation", conversationId },
    history: "rewindable",
    fork: "asOf",
  });
  return { rootId, childId, secondChildId, sourceId, createdAt, childRecord };
});

type CopySource = Effect.Success<ReturnType<typeof seedCopySource>>;

const copyBases = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  { rootId, childId, secondChildId, sourceId, createdAt, childRecord }: CopySource,
) {
  const historicalCopyId = yield* mint<DocumentId>(storage);
  const currentCopyId = yield* mint<DocumentId>(storage);
  const retiredCopyId = yield* mint<DocumentId>(storage);
  const current = { id: sourceId, at: "current" } as const;
  yield* commit(storage, [
    {
      type: "document.copy",
      record: childRecord(historicalCopyId, childId),
      source: { id: sourceId, at: createdAt },
    },
    { type: "document.copy", record: childRecord(currentCopyId, secondChildId), source: current },
    { type: "document.copy", record: childRecord(retiredCopyId, rootId), source: current },
    { type: "document.retire", id: retiredCopyId },
  ]);
  expect(yield* documentAt(storage, historicalCopyId, "current")).toMatchObject({
    version: 2,
    value: { count: 1, rows: [{ value: "base" }] },
  });
  expect(yield* documentAt(storage, currentCopyId, "current")).toMatchObject({
    version: 2,
    value: copiedRows,
  });
  expect(yield* documentAt(storage, retiredCopyId, "current")).toBeUndefined();
  yield* commit(storage, [
    {
      type: "document.change",
      id: sourceId,
      content: { kind: "base", version: 2, value: { count: 99, rows: [] } },
    },
    { type: "document.retire", id: sourceId },
  ]);
  expect((yield* documentAt(storage, currentCopyId, "current"))?.value).toEqual(copiedRows);
  return currentCopyId;
});

const copyLatest = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  { rootId, childId }: CopySource,
) {
  const latestSourceId = yield* mint<DocumentId>(storage);
  const latestCopyId = yield* mint<DocumentId>(storage);
  const latestSource = {
    id: latestSourceId,
    kind: "copy.latest",
    scope: { kind: "conversation", conversationId: rootId },
    history: "latest",
    fork: "current",
  } satisfies DocumentCreate;
  yield* commit(storage, [
    {
      type: "document.create",
      record: latestSource,
      content: { kind: "base", version: 4, value: { retained: "copy" } },
    },
  ]);
  yield* commit(storage, [
    {
      type: "document.copy",
      record: {
        ...latestSource,
        id: latestCopyId,
        scope: { kind: "conversation", conversationId: childId },
      },
      source: { id: latestSourceId, at: "current" },
    },
  ]);
  yield* commit(storage, [
    {
      type: "document.change",
      id: latestSourceId,
      content: { kind: "base", version: 4, value: { retained: "source-only" } },
    },
    { type: "document.retire", id: latestSourceId },
  ]);
  expect(yield* documentAt(storage, latestCopyId, "current")).toMatchObject({
    version: 4,
    value: { retained: "copy" },
  });
});

const rejectAmbiguousCopies = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  { childId, childRecord }: CopySource,
  currentCopyId: DocumentId,
) {
  const source = { id: currentCopyId, at: "current" } as const;
  const conflictId = yield* mint<DocumentId>(storage);
  const conflictError = yield* failureOf(
    commit(storage, [
      { type: "document.copy", record: childRecord(conflictId, childId), source },
      { type: "document.retire", id: currentCopyId },
    ]),
  );
  expect(conflictError instanceof Error).toBe(true);
  expect(yield* documentAt(storage, conflictId, "current")).toBeUndefined();
  expect((yield* documentAt(storage, currentCopyId, "current"))?.value).toEqual(copiedRows);

  const mismatchId = yield* mint<DocumentId>(storage);
  const mismatchError = yield* failureOf(
    commit(storage, [
      {
        type: "document.copy",
        record: { ...childRecord(mismatchId, childId), kind: "copy.mismatch" },
        source,
      },
    ]),
  );
  expect(mismatchError instanceof Error).toBe(true);
  expect(yield* documentAt(storage, mismatchId, "current")).toBeUndefined();
});

const copiedBases: StorageCaseSpec = {
  name: "copies stored document bases independently and rejects ambiguous sources",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const source = yield* seedCopySource(storage);
      const currentCopyId = yield* copyBases(storage, expect, source);
      yield* copyLatest(storage, expect, source);
      yield* rejectAmbiguousCopies(storage, expect, source, currentCopyId);
    }),
};

export const documentsCopyCases: readonly StorageCaseSpec[] = [copiedBases];
