import type { Op } from "@msa/chord/delta";
import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import rangeModule from "./range.ts";
import storageConformanceSupport from "./storage-conformance-support.ts";
import type storageConformanceSupportTypes from "./storage-conformance-support.types.ts";

const { commit, context, createRoot, documentAt, documentIds, io, mint } =
  storageConformanceSupport;
const { range } = rangeModule;

const createAndChange = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
) {
  const rootId = yield* createRoot(storage);
  const firstId = yield* mint<typesModule.DocumentId>(storage);
  const firstRecord = {
    fork: "asOf",
    history: "rewindable",
    id: firstId,
    kind: "conversation.notes",
    scope: { conversationId: rootId, kind: "conversation" },
  } satisfies typesModule.DocumentCreate;
  const initial: typesModule.JsonObject = { items: ["a"], nested: { count: 1 } };
  const createdAt = yield* commit(storage, [
    {
      content: { kind: "base", value: initial, version: 1 },
      record: firstRecord,
      type: "document.create",
    },
  ]);
  const appended = ["b"];
  const ops: Op[] = [
    ["p", ["items"], 1, 0, appended],
    ["s", ["nested", "count"], 2],
  ];
  const changedAt = yield* commit(storage, [
    { content: { kind: "delta", ops, version: 1 }, id: firstId, type: "document.change" },
  ]);
  (initial["items"] as string[]).push("caller mutation");
  appended.push("caller mutation");
  expect(yield* documentAt(storage, firstId, createdAt)).toMatchObject({
    deltasSinceBase: 0,
    value: { items: ["a"], nested: { count: 1 } },
    version: 1,
  });
  const changed = (yield* documentAt(storage, firstId, changedAt))!;
  expect(changed.value).toEqual({ items: ["a", "b"], nested: { count: 2 } });
  expect(changed.deltasSinceBase).toBe(1);
  (changed.value["items"] as string[]).push("read mutation");
  expect((yield* documentAt(storage, firstId, "current"))?.value).toEqual({
    items: ["a", "b"],
    nested: { count: 2 },
  });
  return { changedAt, firstRecord };
});

const checkpointAndReplace = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  firstId: typesModule.DocumentId,
  changedAt: typesModule.Seq,
) {
  const checkpointAt = yield* commit(storage, [
    {
      content: { kind: "base", value: { items: ["checkpoint"], nested: { count: 3 } }, version: 2 },
      id: firstId,
      type: "document.change",
    },
  ]);
  const replacedAt = yield* commit(storage, [
    {
      content: {
        kind: "delta",
        ops: [["r", { items: ["replacement"], nested: { count: 4 } }]],
        version: 2,
      },
      id: firstId,
      type: "document.change",
    },
  ]);
  expect(yield* documentAt(storage, firstId, changedAt)).toMatchObject({
    value: { items: ["a", "b"], nested: { count: 2 } },
    version: 1,
  });
  expect(yield* documentAt(storage, firstId, checkpointAt)).toMatchObject({
    deltasSinceBase: 0,
    value: { items: ["checkpoint"], nested: { count: 3 } },
    version: 2,
  });
  expect(yield* documentAt(storage, firstId, replacedAt)).toMatchObject({
    deltasSinceBase: 1,
    value: { items: ["replacement"], nested: { count: 4 } },
  });
  expect((yield* documentAt(storage, firstId, "current"))?.deltasSinceBase).toBe(1);
});

type NotesRecord = Effect.Success<ReturnType<typeof createAndChange>>["firstRecord"];

const retireIncarnation = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  firstRecord: NotesRecord,
  changedAt: typesModule.Seq,
) {
  const firstId = firstRecord.id;
  const secondId = yield* mint<typesModule.DocumentId>(storage);
  const retiredAt = yield* commit(storage, [
    {
      content: { kind: "base", value: { items: ["new"] }, version: 1 },
      record: { ...firstRecord, id: secondId },
      type: "document.create",
    },
    { id: firstId, type: "document.retire" },
    {
      content: { kind: "delta", ops: [["s", ["retiring"], true]], version: 2 },
      id: firstId,
      type: "document.change",
    },
  ]);
  const address = { kind: firstRecord.kind, scope: firstRecord.scope };
  expect((yield* io(() => storage.findDocument(address, changedAt, context)))?.id).toBe(firstId);
  expect(yield* io(() => storage.findDocument(address, retiredAt, context))).toMatchObject({
    createdAt: retiredAt,
    id: secondId,
  });
  expect(yield* documentIds(storage, { at: changedAt, scope: firstRecord.scope })).toEqual([
    firstId,
  ]);
  expect(yield* documentIds(storage, { at: retiredAt, scope: firstRecord.scope })).toEqual([
    secondId,
  ]);
  expect(yield* documentAt(storage, firstId, retiredAt)).toBeUndefined();
  expect((yield* documentAt(storage, secondId, "current"))?.value).toEqual({ items: ["new"] });
});

const rewindableDocuments: storageConformanceSupportTypes.StorageCaseSpec = {
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
  storage: typesModule.Storage,
  id: typesModule.DocumentId,
  rows: Rows,
  index: number,
  revision: number,
) {
  rows.rows[index]!.value = -revision;
  rows.revision = revision;
  return yield* commit(storage, [
    {
      content: {
        kind: "delta",
        ops: [
          ["s", ["rows", index, "value"], -revision],
          ["s", ["revision"], revision],
        ],
        version: 1,
      },
      id,
      type: "document.change",
    },
  ]);
});

const seedTail = Effect.fnUntraced(function* (storage: typesModule.Storage) {
  const rootId = yield* createRoot(storage);
  const id = yield* mint<typesModule.DocumentId>(storage);
  const record = {
    fork: "asOf",
    history: "rewindable",
    id,
    kind: "conversation.long-tail",
    scope: { conversationId: rootId, kind: "conversation" },
  } satisfies typesModule.DocumentCreate;
  const initial: Rows = {
    revision: 0,
    rows: Array.from({ length: 512 }, (_, value) => ({ stable: `row-${value}`, value })),
  };
  const createdAt = yield* commit(storage, [
    { content: { kind: "base", value: initial, version: 1 }, record, type: "document.create" },
  ]);
  const beforeReplacement = structuredClone(initial);
  let beforeReplacementAt = createdAt;
  for (const revision of range(1, 25)) {
    const index = (revision * 17) % beforeReplacement.rows.length;
    beforeReplacementAt = yield* changeRow(storage, id, beforeReplacement, index, revision);
  }
  return { beforeReplacement, beforeReplacementAt, createdAt, id, initial };
});

const replaceTail = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  id: typesModule.DocumentId,
) {
  const replacement: Rows = {
    revision: 100,
    rows: Array.from({ length: 512 }, (_, value) => ({
      stable: `new-${value}`,
      value: 10_000 + value,
    })),
  };
  const replacementSnapshot = structuredClone(replacement);
  const replacementAt = yield* commit(storage, [
    {
      content: { kind: "delta", ops: [["r", replacement]], version: 1 },
      id,
      type: "document.change",
    },
  ]);
  replacement.rows[0]!.value = -999;
  const current = structuredClone(replacementSnapshot);
  for (const revision of range(101, 125)) {
    yield* changeRow(storage, id, current, (revision * 19) % current.rows.length, revision);
  }
  return { current, replacementAt, replacementSnapshot };
});

const longTails: storageConformanceSupportTypes.StorageCaseSpec = {
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

const documentsHistoryCases: readonly storageConformanceSupportTypes.StorageCaseSpec[] = [
  rewindableDocuments,
  longTails,
];

const storageConformanceDocumentsHistory = {
  documentsHistoryCases,
};

export default storageConformanceDocumentsHistory;
