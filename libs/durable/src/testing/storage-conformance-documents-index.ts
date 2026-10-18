import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";

import type {
  DocumentCreate,
  DocumentId,
  JsonObject,
  Storage,
  StorageWrite,
  TaskId,
} from "../types.ts";
import {
  commit,
  context,
  createRoot,
  documentAt,
  documentIds,
  type Expect,
  io,
  mint,
  pendingTask,
  type StorageCaseSpec,
} from "./storage-conformance-support.ts";

const created = (record: DocumentCreate, value: JsonObject): StorageWrite => ({
  type: "document.create",
  record,
  content: { kind: "base", version: 1, value },
});

const versionTransitions: StorageCaseSpec = {
  name: "uses bases for version transitions and rejects historical reads of current-only documents",
  test: (storage, expect) =>
    Effect.gen(function* () {
      yield* createRoot(storage);
      const id = yield* mint<DocumentId>(storage);
      yield* commit(storage, [
        created({ id, kind: "session.settings", scope: { kind: "session" } }, { count: 1 }),
      ]);
      yield* commit(storage, [
        {
          type: "document.change",
          id,
          content: { kind: "delta", version: 1, ops: [["s", ["count"], 2]] },
        },
      ]);
      const migratedAt = yield* commit(storage, [
        { type: "document.change", id, content: { kind: "base", version: 2, value: { count: 3 } } },
      ]);
      expect(yield* documentAt(storage, id, "current")).toMatchObject({
        version: 2,
        value: { count: 3 },
      });
      yield* expect(storage.document(id, migratedAt, context)).rejects.toThrow(
        "does not retain historical content",
      );
      yield* expect(
        storage.commit(
          [
            {
              type: "document.change",
              id,
              content: { kind: "delta", version: 1, ops: [["s", ["count"], 4]] },
            },
          ],
          context,
        ),
      ).rejects.toThrow("version transition requires a base");
      expect((yield* documentAt(storage, id, "current"))?.value).toEqual({ count: 3 });
      yield* commit(storage, [{ type: "document.retire", id }]);
      expect(yield* documentAt(storage, id, "current")).toBeUndefined();
    }),
};

const seedAddresses = Effect.fnUntraced(function* (storage: Storage) {
  const rootId = yield* createRoot(storage);
  const firstId = yield* mint<DocumentId>(storage);
  const secondId = yield* mint<DocumentId>(storage);
  const conversationId = yield* mint<DocumentId>(storage);
  const taskId = yield* mint<TaskId<JsonValue>>(storage);
  const taskSingletonId = yield* mint<DocumentId>(storage);
  const taskFamilyId = yield* mint<DocumentId>(storage);
  const taskOtherKindId = yield* mint<DocumentId>(storage);
  const session = { kind: "session" } as const;
  const task = { kind: "task", taskId } as const;
  const createdAt = yield* commit(storage, [
    { type: "task", value: pendingTask(taskId, rootId) },
    created({ id: firstId, kind: "cache", scope: session, key: "__proto__" }, { owner: "first" }),
    created(
      { id: secondId, kind: "cache", scope: session, key: "constructor" },
      { owner: "second" },
    ),
    created(
      {
        id: conversationId,
        kind: "cache",
        scope: { kind: "conversation", conversationId: rootId },
        history: "latest",
        fork: "current",
        key: "__proto__",
      },
      { owner: "conversation" },
    ),
    created({ id: taskSingletonId, kind: "task.cache", scope: task }, { owner: "singleton" }),
    created(
      { id: taskFamilyId, kind: "task.cache", scope: task, key: "member" },
      { owner: "family" },
    ),
    created({ id: taskOtherKindId, kind: "task.other", scope: task }, { owner: "other" }),
  ]);
  return {
    rootId,
    firstId,
    secondId,
    conversationId,
    taskId,
    taskSingletonId,
    taskFamilyId,
    createdAt,
  };
});

type Addresses = Effect.Success<ReturnType<typeof seedAddresses>>;

const foundId = (storage: Storage, address: Parameters<Storage["findDocument"]>[0]) =>
  Effect.map(
    io(() => storage.findDocument(address, "current", context)),
    (found) => found?.id,
  );

const expectSessionAddresses = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  { rootId, firstId, secondId, conversationId }: Addresses,
) {
  const session = { scope: { kind: "session" }, at: "current" } as const;
  expect(
    yield* foundId(storage, { kind: "cache", scope: { kind: "session" }, key: "__proto__" }),
  ).toBe(firstId);
  expect(
    (yield* io(() => storage.scanDocuments(session, 1, undefined, context))).items,
  ).toHaveLength(1);
  const first = yield* io(() => storage.scanDocuments(session, 1, undefined, context));
  const second = yield* io(() => storage.scanDocuments(session, 1, first.next, context));
  expect([...first.items, ...second.items].map(({ id }) => id)).toEqual([firstId, secondId]);
  const conversation = { kind: "conversation", conversationId: rootId } as const;
  expect(yield* documentIds(storage, { scope: conversation, at: "current" })).toEqual([
    conversationId,
  ]);
});

const expectTaskAddresses = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  { taskId, taskSingletonId, taskFamilyId, createdAt }: Addresses,
) {
  const scope = { kind: "task", taskId } as const;
  expect(yield* foundId(storage, { kind: "task.cache", scope })).toBe(taskSingletonId);
  expect(yield* foundId(storage, { kind: "task.cache", scope, key: "member" })).toBe(taskFamilyId);
  expect(yield* documentIds(storage, { scope, at: "current", kind: "task.cache" })).toEqual([
    taskSingletonId,
    taskFamilyId,
  ]);
  yield* expect(storage.document(taskSingletonId, createdAt, context)).rejects.toThrow(
    "does not retain historical content",
  );
});

const logicalAddresses: StorageCaseSpec = {
  name: "indexes logical addresses and exact-scope scans independently",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const addresses = yield* seedAddresses(storage);
      yield* expectSessionAddresses(storage, expect, addresses);
      yield* expectTaskAddresses(storage, expect, addresses);
    }),
};

export const documentsIndexCases: readonly StorageCaseSpec[] = [
  versionTransitions,
  logicalAddresses,
];
