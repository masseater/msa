import type { Op } from "@msa/chord/delta";
import { Effect } from "effect";

import type { DocumentCreate, DocumentId, JsonObject, Seq, Storage } from "../types.ts";
import { range } from "./range.ts";
import {
  commit,
  context,
  createRoot,
  documentAt,
  documentIds,
  type Expect,
  io,
  mint,
  type StorageCaseSpec,
} from "./storage-conformance-support.ts";

const createAndChange = Effect.fnUntraced(function* (storage: Storage, expect: Expect) {
  const rootId = yield* createRoot(storage);
  const firstId = yield* mint<DocumentId>(storage);
  const firstRecord = {
    id: firstId,
    kind: "conversation.notes",
    scope: { kind: "conversation", conversationId: rootId },
    history: "rewindable",
    fork: "asOf",
  } satisfies DocumentCreate;
  const initial: JsonObject = { items: ["a"], nested: { count: 1 } };
  const createdAt = yield* commit(storage, [
    {
      type: "document.create",
      record: firstRecord,
      content: { kind: "base", version: 1, value: initial },
    },
  ]);
  const appended = ["b"];
  const ops: Op[] = [
    ["p", ["items"], 1, 0, appended],
    ["s", ["nested", "count"], 2],
  ];
  const changedAt = yield* commit(storage, [
    { type: "document.change", id: firstId, content: { kind: "delta", version: 1, ops } },
  ]);
  (initial["items"] as string[]).push("caller mutation");
  appended.push("caller mutation");
  expect(yield* documentAt(storage, firstId, createdAt)).toMatchObject({
    version: 1,
    value: { items: ["a"], nested: { count: 1 } },
    deltasSinceBase: 0,
  });
  const changed = (yield* documentAt(storage, firstId, changedAt))!;
  expect(changed.value).toEqual({ items: ["a", "b"], nested: { count: 2 } });
  expect(changed.deltasSinceBase).toBe(1);
  (changed.value["items"] as string[]).push("read mutation");
  expect((yield* documentAt(storage, firstId, "current"))?.value).toEqual({
    items: ["a", "b"],
    nested: { count: 2 },
  });
  return { firstRecord, changedAt };
});

const checkpointAndReplace = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  firstId: DocumentId,
  changedAt: Seq,
) {
  const checkpointAt = yield* commit(storage, [
    {
      type: "document.change",
      id: firstId,
      content: { kind: "base", version: 2, value: { items: ["checkpoint"], nested: { count: 3 } } },
    },
  ]);
  const replacedAt = yield* commit(storage, [
    {
      type: "document.change",
      id: firstId,
      content: {
        kind: "delta",
        version: 2,
        ops: [["r", { items: ["replacement"], nested: { count: 4 } }]],
      },
    },
  ]);
  expect(yield* documentAt(storage, firstId, changedAt)).toMatchObject({
    version: 1,
    value: { items: ["a", "b"], nested: { count: 2 } },
  });
  expect(yield* documentAt(storage, firstId, checkpointAt)).toMatchObject({
    version: 2,
    value: { items: ["checkpoint"], nested: { count: 3 } },
    deltasSinceBase: 0,
  });
  expect(yield* documentAt(storage, firstId, replacedAt)).toMatchObject({
    value: { items: ["replacement"], nested: { count: 4 } },
    deltasSinceBase: 1,
  });
  expect((yield* documentAt(storage, firstId, "current"))?.deltasSinceBase).toBe(1);
});

type NotesRecord = Effect.Success<ReturnType<typeof createAndChange>>["firstRecord"];

const retireIncarnation = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  firstRecord: NotesRecord,
  changedAt: Seq,
) {
  const firstId = firstRecord.id;
  const secondId = yield* mint<DocumentId>(storage);
  const retiredAt = yield* commit(storage, [
    {
      type: "document.create",
      record: { ...firstRecord, id: secondId },
      content: { kind: "base", version: 1, value: { items: ["new"] } },
    },
    { type: "document.retire", id: firstId },
    {
      type: "document.change",
      id: firstId,
      content: { kind: "delta", version: 2, ops: [["s", ["retiring"], true]] },
    },
  ]);
  const address = { kind: firstRecord.kind, scope: firstRecord.scope };
  expect((yield* io(() => storage.findDocument(address, changedAt, context)))?.id).toBe(firstId);
  expect(yield* io(() => storage.findDocument(address, retiredAt, context))).toMatchObject({
    id: secondId,
    createdAt: retiredAt,
  });
  expect(yield* documentIds(storage, { scope: firstRecord.scope, at: changedAt })).toEqual([
    firstId,
  ]);
  expect(yield* documentIds(storage, { scope: firstRecord.scope, at: retiredAt })).toEqual([
    secondId,
  ]);
  expect(yield* documentAt(storage, firstId, retiredAt)).toBeUndefined();
  expect((yield* documentAt(storage, secondId, "current"))?.value).toEqual({ items: ["new"] });
});

const rewindableDocuments: StorageCaseSpec = {
  name: "reconstructs rewindable documents and preserves half-open incarnations",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const { firstRecord, changedAt } = yield* createAndChange(storage, expect);
      yield* checkpointAndReplace(storage, expect, firstRecord.id, changedAt);
      yield* retireIncarnation(storage, expect, firstRecord, changedAt);
    }),
};

type Rows = { revision: number; rows: { value: number; stable: string }[] };

const changeRow = Effect.fnUntraced(function* (
  storage: Storage,
  id: DocumentId,
  rows: Rows,
  index: number,
  revision: number,
) {
  rows.rows[index]!.value = -revision;
  rows.revision = revision;
  return yield* commit(storage, [
    {
      type: "document.change",
      id,
      content: {
        kind: "delta",
        version: 1,
        ops: [
          ["s", ["rows", index, "value"], -revision],
          ["s", ["revision"], revision],
        ],
      },
    },
  ]);
});

const seedTail = Effect.fnUntraced(function* (storage: Storage) {
  const rootId = yield* createRoot(storage);
  const id = yield* mint<DocumentId>(storage);
  const record = {
    id,
    kind: "conversation.long-tail",
    scope: { kind: "conversation", conversationId: rootId },
    history: "rewindable",
    fork: "asOf",
  } satisfies DocumentCreate;
  const initial: Rows = {
    revision: 0,
    rows: Array.from({ length: 512 }, (_, value) => ({ value, stable: `row-${value}` })),
  };
  const createdAt = yield* commit(storage, [
    { type: "document.create", record, content: { kind: "base", version: 1, value: initial } },
  ]);
  const beforeReplacement = structuredClone(initial);
  let beforeReplacementAt = createdAt;
  for (const revision of range(1, 25)) {
    const index = (revision * 17) % beforeReplacement.rows.length;
    beforeReplacementAt = yield* changeRow(storage, id, beforeReplacement, index, revision);
  }
  return { id, initial, createdAt, beforeReplacement, beforeReplacementAt };
});

const replaceTail = Effect.fnUntraced(function* (storage: Storage, id: DocumentId) {
  const replacement: Rows = {
    revision: 100,
    rows: Array.from({ length: 512 }, (_, value) => ({
      value: 10_000 + value,
      stable: `new-${value}`,
    })),
  };
  const replacementSnapshot = structuredClone(replacement);
  const replacementAt = yield* commit(storage, [
    {
      type: "document.change",
      id,
      content: { kind: "delta", version: 1, ops: [["r", replacement]] },
    },
  ]);
  replacement.rows[0]!.value = -999;
  const current = structuredClone(replacementSnapshot);
  for (const revision of range(101, 125)) {
    yield* changeRow(storage, id, current, (revision * 19) % current.rows.length, revision);
  }
  return { replacementSnapshot, replacementAt, current };
});

const longTails: StorageCaseSpec = {
  name: "streams long document tails across root replacement deltas",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const { id, initial, createdAt, beforeReplacement, beforeReplacementAt } =
        yield* seedTail(storage);
      const { replacementSnapshot, replacementAt, current } = yield* replaceTail(storage, id);
      expect((yield* documentAt(storage, id, createdAt))?.value).toEqual(initial);
      expect((yield* documentAt(storage, id, beforeReplacementAt))?.value).toEqual(
        beforeReplacement,
      );
      expect((yield* documentAt(storage, id, replacementAt))?.value).toEqual(replacementSnapshot);
      const read = (yield* documentAt(storage, id, "current"))!;
      expect(read.value).toEqual(current);
      (read.value["rows"] as Array<{ value: number }>)[0]!.value = -1_000;
      expect((yield* documentAt(storage, id, "current"))?.value).toEqual(current);
    }),
};

export const documentsHistoryCases: readonly StorageCaseSpec[] = [rewindableDocuments, longTails];
