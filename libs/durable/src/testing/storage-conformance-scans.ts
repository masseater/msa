import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";

import { idFromNumber } from "../ids.ts";
import {
  type ConversationId,
  type Cursor,
  type EntryId,
  type Page,
  type ScanOrder,
  type Storage,
  type SubmissionId,
  type TaskId,
} from "../types.ts";
import {
  commit,
  context,
  createRoot,
  entry,
  type Identified,
  io,
  mint,
  pendingTask,
  roundTripJson,
  type StorageCaseSpec,
} from "./storage-conformance-support.ts";

const outOfOrderEntries: StorageCaseSpec = {
  name: "indexes entries committed out of ID order",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const rootId = yield* createRoot(storage);
      yield* commit(storage, [
        { type: "entry", value: entry(idFromNumber<EntryId>(30), rootId) },
        { type: "entry", value: entry(idFromNumber<EntryId>(10), rootId) },
        {
          type: "entry",
          value: entry(idFromNumber<EntryId>(20), rootId, "marker", {
            head: idFromNumber<EntryId>(10),
          }),
        },
      ]);

      expect(
        (yield* io(() =>
          storage.scanEntries({ conversationId: rootId }, 10, undefined, context),
        )).items.map(({ id }) => id),
      ).toEqual([30, 20, 10]);
      expect((yield* io(() => storage.findLatestHeadMarker(rootId, undefined, context)))?.id).toBe(
        20,
      );
    }),
};

const cursorAfterCommit: StorageCaseSpec = {
  name: "continues an entry cursor below its last item after a newer commit",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const rootId = yield* createRoot(storage);
      const oldestId = yield* mint<EntryId>(storage);
      const middleId = yield* mint<EntryId>(storage);
      const newestId = yield* mint<EntryId>(storage);
      yield* commit(storage, [
        { type: "entry", value: entry(oldestId, rootId) },
        { type: "entry", value: entry(middleId, rootId) },
        { type: "entry", value: entry(newestId, rootId) },
      ]);

      const first = yield* io(() =>
        storage.scanEntries({ conversationId: rootId }, 2, undefined, context),
      );
      expect(first.items.map(({ id }) => id)).toEqual([newestId, middleId]);
      const appendedId = yield* mint<EntryId>(storage);
      yield* commit(storage, [{ type: "entry", value: entry(appendedId, rootId) }]);
      const second = yield* io(() =>
        storage.scanEntries({ conversationId: rootId }, 2, first.next, context),
      );
      expect(second.items.map(({ id }) => id)).toEqual([oldestId]);
      expect(second.next).toBeUndefined();
    }),
};

const conversationPages: StorageCaseSpec = {
  name: "paginates conversations by opaque cursor in ascending ID order",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const rootId = yield* createRoot(storage);
      const secondId = yield* mint<ConversationId>(storage);
      const thirdId = yield* mint<ConversationId>(storage);
      yield* commit(storage, [
        { type: "conversation", value: { id: thirdId } },
        { type: "conversation", value: { id: secondId } },
      ]);

      const first = yield* io(() => storage.scanConversations({}, 2, undefined, context));
      expect(first.items.map(({ id }) => id)).toEqual([rootId, secondId]);
      expect(first.next).toBeDefined();
      const roundTrippedCursor = (yield* roundTripJson(first.next)) as NonNullable<
        typeof first.next
      >;
      const second = yield* io(() => storage.scanConversations({}, 2, roundTrippedCursor, context));
      expect(second.items.map(({ id }) => id)).toEqual([thirdId]);
      expect(second.next).toBeUndefined();
    }),
};

const seedOwners = Effect.fnUntraced(function* (storage: Storage) {
  const rootId = yield* createRoot(storage);
  const otherOwnerId = yield* mint<ConversationId>(storage);
  const firstTaskId = yield* mint<TaskId<JsonValue>>(storage);
  const secondTaskId = yield* mint<TaskId<JsonValue>>(storage);
  const firstId = yield* mint<ConversationId>(storage);
  const secondId = yield* mint<ConversationId>(storage);
  const thirdId = yield* mint<ConversationId>(storage);
  const owned = (id: ConversationId, conversationId: ConversationId, taskId: TaskId<JsonValue>) =>
    ({ type: "conversation", value: { id, owner: { conversationId, taskId } } }) as const;
  yield* commit(storage, [
    { type: "conversation", value: { id: otherOwnerId } },
    owned(firstId, rootId, firstTaskId),
    owned(secondId, rootId, secondTaskId),
    owned(thirdId, otherOwnerId, firstTaskId),
  ]);
  return { rootId, firstTaskId, firstId, secondId, thirdId };
});

const ownerEdges: StorageCaseSpec = {
  name: "filters and pages conversations by durable owner edges",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const { rootId, firstTaskId, firstId, secondId, thirdId } = yield* seedOwners(storage);
      const first = yield* io(() =>
        storage.scanConversations({ ownerConversationId: rootId }, 1, undefined, context),
      );
      expect(first.items.map(({ id }) => id)).toEqual([firstId]);
      expect(first.next).toBeDefined();
      const second = yield* io(() =>
        storage.scanConversations({ ownerConversationId: rootId }, 1, first.next, context),
      );
      expect(second.items.map(({ id }) => id)).toEqual([secondId]);
      expect(second.next).toBeUndefined();
      expect(
        (yield* io(() =>
          storage.scanConversations({ ownerTaskId: firstTaskId }, 10, undefined, context),
        )).items.map(({ id }) => id),
      ).toEqual([firstId, thirdId]);
      expect(
        (yield* io(() =>
          storage.scanConversations(
            { ownerConversationId: rootId, ownerTaskId: firstTaskId },
            10,
            undefined,
            context,
          ),
        )).items.map(({ id }) => id),
      ).toEqual([firstId]);
    }),
};

const seedTables = Effect.fnUntraced(function* (storage: Storage) {
  const rootId = yield* createRoot(storage);
  const conversationIds = [rootId];
  const taskIds: TaskId<JsonValue>[] = [];
  const submissionIds: SubmissionId[] = [];
  for (let index = 0; index < 3; index += 1) {
    const conversationId = yield* mint<ConversationId>(storage);
    const taskId = yield* mint<TaskId<JsonValue>>(storage);
    const submissionId = yield* mint<SubmissionId>(storage);
    yield* commit(storage, [
      { type: "conversation", value: { id: conversationId } },
      { type: "task", value: pendingTask(taskId, rootId) },
      {
        type: "submission",
        value: { id: submissionId, conversationId: rootId, type: "input", status: "queued" },
      },
    ]);
    conversationIds.push(conversationId);
    taskIds.push(taskId);
    submissionIds.push(submissionId);
  }
  return { conversationIds, taskIds, submissionIds };
});

type Scan = (
  order: ScanOrder | undefined,
  cursor: Cursor | undefined,
) => Promise<Page<Identified, Cursor>>;

const scanAll = Effect.fnUntraced(function* (scan: Scan, order: ScanOrder | undefined) {
  const found: number[] = [];
  let page = yield* io(() => scan(order, undefined));
  found.push(...page.items.map(({ id }) => id));
  while (page.next !== undefined) {
    const cursor = (yield* roundTripJson(page.next)) as Cursor;
    page = yield* io(() => scan(undefined, cursor));
    found.push(...page.items.map(({ id }) => id));
  }
  return found;
});

const tableOrders: StorageCaseSpec = {
  name: "scans tables in either ID order and continues a cursor in its order",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const { conversationIds, taskIds, submissionIds } = yield* seedTables(storage);
      const orderOf = (order: ScanOrder | undefined) => (order === undefined ? {} : { order });
      const scans: readonly (readonly [Scan, readonly number[]])[] = [
        [
          (order, cursor) => storage.scanConversations(orderOf(order), 2, cursor, context),
          conversationIds,
        ],
        [(order, cursor) => storage.scanTasks(orderOf(order), 2, cursor, context), taskIds],
        [
          (order, cursor) => storage.scanSubmissions(orderOf(order), 2, cursor, context),
          submissionIds,
        ],
      ];
      for (const [scan, ids] of scans) {
        const reversed = [...ids].reverse();
        expect(yield* scanAll(scan, undefined)).toEqual(ids);
        expect(yield* scanAll(scan, "ascending")).toEqual(ids);
        expect(yield* scanAll(scan, "descending")).toEqual(reversed);
        const descending = yield* io(() => scan("descending", undefined));
        expect(
          (yield* io(() => scan("descending", descending.next))).items.map(({ id }) => id),
        ).toEqual(reversed.slice(2, 4));
        yield* expect(scan("ascending", descending.next)).rejects.toThrow("cursor");
      }
    }),
};

export const scansCases: readonly StorageCaseSpec[] = [
  outOfOrderEntries,
  cursorAfterCommit,
  conversationPages,
  ownerEdges,
];

export const tableOrderCases: readonly StorageCaseSpec[] = [tableOrders];
