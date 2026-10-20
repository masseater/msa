import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import storageConformanceSupport from "./storage-conformance-support.ts";
import type storageConformanceSupportTypes from "./storage-conformance-support.types.ts";

const { commit, context, createRoot, documentAt, documentIds, io, mint, pendingTask } =
  storageConformanceSupport;

const created = (
  record: typesModule.DocumentCreate,
  value: typesModule.JsonObject,
): typesModule.StorageWrite => ({
  content: { kind: "base", value, version: 1 },
  record,
  type: "document.create",
});

const versionTransitions: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "uses bases for version transitions and rejects historical reads of current-only documents",
  test: (storage, expect) =>
    Effect.gen(function* () {
      yield* createRoot(storage);
      const id = yield* mint<typesModule.DocumentId>(storage);
      yield* commit(storage, [
        created({ id, kind: "session.settings", scope: { kind: "session" } }, { count: 1 }),
      ]);
      yield* commit(storage, [
        {
          content: { kind: "delta", ops: [["s", ["count"], 2]], version: 1 },
          id,
          type: "document.change",
        },
      ]);
      const migratedAt = yield* commit(storage, [
        { content: { kind: "base", value: { count: 3 }, version: 2 }, id, type: "document.change" },
      ]);
      expect(yield* documentAt(storage, id, "current")).toMatchObject({
        value: { count: 3 },
        version: 2,
      });
      yield* expect(storage.document(id, migratedAt, context)).rejects.toThrow(
        "does not retain historical content",
      );
      yield* expect(
        storage.commit(
          [
            {
              content: { kind: "delta", ops: [["s", ["count"], 4]], version: 1 },
              id,
              type: "document.change",
            },
          ],
          context,
        ),
      ).rejects.toThrow("version transition requires a base");
      expect((yield* documentAt(storage, id, "current"))?.value).toEqual({ count: 3 });
      yield* commit(storage, [{ id, type: "document.retire" }]);
      expect(yield* documentAt(storage, id, "current")).toBeUndefined();
    }),
};

const seedAddresses = Effect.fnUntraced(function* (storage: typesModule.Storage) {
  const rootId = yield* createRoot(storage);
  const firstId = yield* mint<typesModule.DocumentId>(storage);
  const secondId = yield* mint<typesModule.DocumentId>(storage);
  const conversationId = yield* mint<typesModule.DocumentId>(storage);
  const taskId = yield* mint<typesModule.TaskId<JsonValue>>(storage);
  const taskSingletonId = yield* mint<typesModule.DocumentId>(storage);
  const taskFamilyId = yield* mint<typesModule.DocumentId>(storage);
  const taskOtherKindId = yield* mint<typesModule.DocumentId>(storage);
  const session = { kind: "session" } as const;
  const task = { kind: "task", taskId } as const;
  const createdAt = yield* commit(storage, [
    { type: "task", value: pendingTask(taskId, rootId) },
    created({ id: firstId, key: "__proto__", kind: "cache", scope: session }, { owner: "first" }),
    created(
      { id: secondId, key: "constructor", kind: "cache", scope: session },
      { owner: "second" },
    ),
    created(
      {
        fork: "current",
        history: "latest",
        id: conversationId,
        key: "__proto__",
        kind: "cache",
        scope: { conversationId: rootId, kind: "conversation" },
      },
      { owner: "conversation" },
    ),
    created({ id: taskSingletonId, kind: "task.cache", scope: task }, { owner: "singleton" }),
    created(
      { id: taskFamilyId, key: "member", kind: "task.cache", scope: task },
      { owner: "family" },
    ),
    created({ id: taskOtherKindId, kind: "task.other", scope: task }, { owner: "other" }),
  ]);
  return {
    conversationId,
    createdAt,
    firstId,
    rootId,
    secondId,
    taskFamilyId,
    taskId,
    taskSingletonId,
  };
});

type Addresses = Effect.Success<ReturnType<typeof seedAddresses>>;

const foundId = (
  storage: typesModule.Storage,
  address: Parameters<typesModule.Storage["findDocument"]>[0],
) =>
  Effect.map(
    io(() => storage.findDocument(address, "current", context)),
    (found) => found?.id,
  );

const expectSessionAddresses = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  { rootId, firstId, secondId, conversationId }: Addresses,
) {
  const session = { at: "current", scope: { kind: "session" } } as const;
  expect(
    yield* foundId(storage, { key: "__proto__", kind: "cache", scope: { kind: "session" } }),
  ).toBe(firstId);
  expect(
    (yield* io(() => storage.scanDocuments(session, 1, undefined, context))).items,
  ).toHaveLength(1);
  const first = yield* io(() => storage.scanDocuments(session, 1, undefined, context));
  const second = yield* io(() => storage.scanDocuments(session, 1, first.next, context));
  expect([...first.items, ...second.items].map(({ id }) => id)).toEqual([firstId, secondId]);
  const conversation = { conversationId: rootId, kind: "conversation" } as const;
  expect(yield* documentIds(storage, { at: "current", scope: conversation })).toEqual([
    conversationId,
  ]);
});

const expectTaskAddresses = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  { taskId, taskSingletonId, taskFamilyId, createdAt }: Addresses,
) {
  const scope = { kind: "task", taskId } as const;
  expect(yield* foundId(storage, { kind: "task.cache", scope })).toBe(taskSingletonId);
  expect(yield* foundId(storage, { key: "member", kind: "task.cache", scope })).toBe(taskFamilyId);
  expect(yield* documentIds(storage, { at: "current", kind: "task.cache", scope })).toEqual([
    taskSingletonId,
    taskFamilyId,
  ]);
  yield* expect(storage.document(taskSingletonId, createdAt, context)).rejects.toThrow(
    "does not retain historical content",
  );
});

const logicalAddresses: storageConformanceSupportTypes.StorageCaseSpec = {
  name: "indexes logical addresses and exact-scope scans independently",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const addresses = yield* seedAddresses(storage);
      yield* expectSessionAddresses(storage, expect, addresses);
      yield* expectTaskAddresses(storage, expect, addresses);
    }),
};

const documentsIndexCases: readonly storageConformanceSupportTypes.StorageCaseSpec[] = [
  versionTransitions,
  logicalAddresses,
];

const storageConformanceDocumentsIndex = {
  documentsIndexCases,
};

export default storageConformanceDocumentsIndex;
