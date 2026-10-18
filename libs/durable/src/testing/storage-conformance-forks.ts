import { Effect } from "effect";

import { idFromNumber } from "../ids.ts";
import type { ConversationId, EntryId, EntryQuery, Seq, Storage } from "../types.ts";
import {
  commit,
  context,
  createRoot,
  entry,
  type Expect,
  io,
  mint,
  type StorageCaseSpec,
} from "./storage-conformance-support.ts";

const seedRootAndChild = Effect.fnUntraced(function* (storage: Storage) {
  const rootId = yield* createRoot(storage);
  const rootFirst = yield* mint<EntryId>(storage);
  const rootForkPoint = yield* mint<EntryId>(storage);
  const rootExcludedSameCommit = yield* mint<EntryId>(storage);
  const rootEntriesSeq = yield* commit(storage, [
    { type: "entry", value: entry(rootFirst, rootId) },
    { type: "entry", value: entry(rootForkPoint, rootId, "marker", { head: rootFirst }) },
    { type: "entry", value: entry(rootExcludedSameCommit, rootId) },
  ]);
  const childId = yield* mint<ConversationId>(storage);
  yield* commit(storage, [
    {
      type: "conversation",
      value: { id: childId, parent: { conversationId: rootId, at: rootForkPoint } },
    },
  ]);
  const childForkPoint = yield* mint<EntryId>(storage);
  const childExcluded = yield* mint<EntryId>(storage);
  yield* commit(storage, [
    { type: "entry", value: entry(childForkPoint, childId, "note") },
    { type: "entry", value: entry(childExcluded, childId) },
  ]);
  const rootExcludedLater = yield* mint<EntryId>(storage);
  yield* commit(storage, [{ type: "entry", value: entry(rootExcludedLater, rootId) }]);
  return {
    rootId,
    rootFirst,
    rootForkPoint,
    rootExcludedSameCommit,
    rootEntriesSeq,
    childId,
    childForkPoint,
    childExcluded,
    rootExcludedLater,
  };
});

type RootAndChild = Effect.Success<ReturnType<typeof seedRootAndChild>>;

const seedForkTree = Effect.fnUntraced(function* (storage: Storage) {
  const tree = yield* seedRootAndChild(storage);
  const grandchildId = yield* mint<ConversationId>(storage);
  yield* commit(storage, [
    {
      type: "conversation",
      value: {
        id: grandchildId,
        parent: { conversationId: tree.childId, at: tree.childForkPoint },
      },
    },
  ]);
  const grandchildHead = yield* mint<EntryId>(storage);
  const grandchildTail = yield* mint<EntryId>(storage);
  const grandchildEntriesSeq = yield* commit(storage, [
    {
      type: "entry",
      value: entry(grandchildHead, grandchildId, "marker", { head: grandchildHead }),
    },
    { type: "entry", value: entry(grandchildTail, grandchildId) },
  ]);
  const childExcludedLater = yield* mint<EntryId>(storage);
  yield* commit(storage, [{ type: "entry", value: entry(childExcludedLater, tree.childId) }]);
  return {
    ...tree,
    grandchildId,
    grandchildHead,
    grandchildTail,
    grandchildEntriesSeq,
    childExcludedLater,
  };
});

type ForkTree = RootAndChild & {
  readonly grandchildId: ConversationId;
  readonly grandchildHead: EntryId;
  readonly grandchildTail: EntryId;
  readonly grandchildEntriesSeq: Seq;
  readonly childExcludedLater: EntryId;
};

const scanIds = (
  storage: Storage,
  query: EntryQuery,
  limit: number,
  cursor: Parameters<Storage["scanEntries"]>[2],
) =>
  Effect.map(
    io(() => storage.scanEntries(query, limit, cursor, context)),
    (page) => ({ ids: page.items.map(({ id }) => id), next: page.next }),
  );

const expectDescendingPages = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  tree: ForkTree,
) {
  const query = { conversationId: tree.grandchildId };
  const first = yield* scanIds(storage, query, 2, undefined);
  expect(first.ids).toEqual([tree.grandchildTail, tree.grandchildHead]);
  const second = yield* scanIds(storage, query, 2, first.next);
  expect(second.ids).toEqual([tree.childForkPoint, tree.rootForkPoint]);
  const third = yield* scanIds(storage, query, 2, second.next);
  expect(third.ids).toEqual([tree.rootFirst]);
  expect(third.next).toBeUndefined();
});

const expectAscendingPages = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  tree: ForkTree,
) {
  const ascending = { conversationId: tree.grandchildId, order: "ascending" } as const;
  const firstUp = yield* scanIds(storage, ascending, 2, undefined);
  expect(firstUp.ids).toEqual([tree.rootFirst, tree.rootForkPoint]);
  const secondUp = yield* scanIds(storage, ascending, 2, firstUp.next);
  expect(secondUp.ids).toEqual([tree.childForkPoint, tree.grandchildHead]);
  const thirdUp = yield* scanIds(storage, { conversationId: tree.grandchildId }, 2, secondUp.next);
  expect(thirdUp.ids).toEqual([tree.grandchildTail]);
  expect(thirdUp.next).toBeUndefined();
  const bounded = { ...ascending, minEntryId: tree.rootForkPoint, maxEntryId: tree.childForkPoint };
  expect((yield* scanIds(storage, bounded, 10, undefined)).ids).toEqual([
    tree.rootForkPoint,
    tree.childForkPoint,
  ]);
  yield* expect(
    storage.scanEntries(
      { conversationId: tree.grandchildId, order: "descending" },
      2,
      firstUp.next,
      context,
    ),
  ).rejects.toThrow("cursor");
});

const expectHeadMarkers = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  tree: ForkTree,
) {
  const currentMarker = yield* io(() =>
    storage.findLatestHeadMarker(tree.grandchildId, undefined, context),
  );
  expect(currentMarker?.id).toBe(tree.grandchildHead);
  expect(currentMarker?.head).toBe(tree.grandchildHead);
  const historicalMarker = yield* io(() =>
    storage.findLatestHeadMarker(tree.grandchildId, tree.childForkPoint, context),
  );
  expect(historicalMarker?.id).toBe(tree.rootForkPoint);
  expect(historicalMarker?.head).toBe(tree.rootFirst);
  expect(
    yield* io(() => storage.findLatestHeadMarker(tree.grandchildId, tree.rootFirst, context)),
  ).toBeUndefined();
  return { currentMarker, historicalMarker };
});

type HeadMarkers = Effect.Success<ReturnType<typeof expectHeadMarkers>>;

const expectMarkerWindows = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  tree: ForkTree,
  { currentMarker, historicalMarker }: HeadMarkers,
) {
  const active = {
    conversationId: tree.grandchildId,
    ...(currentMarker === undefined ? {} : { minEntryId: currentMarker.head }),
  };
  const activeFirst = yield* scanIds(storage, active, 1, undefined);
  expect(activeFirst.ids).toEqual([tree.grandchildTail]);
  expect(activeFirst.next).toBeDefined();
  const activeSecond = yield* scanIds(storage, active, 1, activeFirst.next);
  expect(activeSecond.ids).toEqual([tree.grandchildHead]);
  expect(activeSecond.next).toBeUndefined();
  const historical = {
    conversationId: tree.grandchildId,
    ...(historicalMarker === undefined ? {} : { minEntryId: historicalMarker.head }),
    maxEntryId: tree.childForkPoint,
  };
  expect((yield* scanIds(storage, historical, 10, undefined)).ids).toEqual([
    tree.childForkPoint,
    tree.rootForkPoint,
    tree.rootFirst,
  ]);
});

const expectEntryLookups = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  tree: ForkTree,
) {
  const seqOf = (id: EntryId) =>
    Effect.map(
      io(() => storage.entry(id, context)),
      (found) => found?.commitSeq,
    );
  expect(yield* io(() => storage.entry(tree.rootFirst, context))).toEqual({
    entry: entry(tree.rootFirst, tree.rootId),
    commitSeq: tree.rootEntriesSeq,
  });
  expect(yield* seqOf(tree.rootForkPoint)).toBe(tree.rootEntriesSeq);
  expect(yield* seqOf(tree.grandchildHead)).toBe(tree.grandchildEntriesSeq);
  expect(yield* seqOf(tree.grandchildTail)).toBe(tree.grandchildEntriesSeq);
  expect(yield* io(() => storage.entry(idFromNumber<EntryId>(999_999), context))).toBeUndefined();
});

const expectForkLookups = Effect.fnUntraced(function* (
  storage: Storage,
  expect: Expect,
  tree: ForkTree,
) {
  const inGrandchild = (id: EntryId) => io(() => storage.entry(tree.grandchildId, id, context));
  expect(yield* inGrandchild(tree.rootFirst)).toEqual({
    entry: entry(tree.rootFirst, tree.rootId),
    commitSeq: tree.rootEntriesSeq,
  });
  expect((yield* inGrandchild(tree.childForkPoint))?.entry.conversationId).toBe(tree.childId);
  expect((yield* inGrandchild(tree.grandchildTail))?.commitSeq).toBe(tree.grandchildEntriesSeq);
  for (const excluded of [
    tree.rootExcludedSameCommit,
    tree.rootExcludedLater,
    tree.childExcluded,
    tree.childExcludedLater,
  ]) {
    expect(yield* inGrandchild(excluded)).toBeUndefined();
  }
  expect(yield* io(() => storage.entry(tree.rootId, tree.grandchildHead, context))).toBeUndefined();
  expect(yield* inGrandchild(idFromNumber<EntryId>(999_999))).toBeUndefined();
  const unknown = idFromNumber<ConversationId>(999_999);
  yield* expect(storage.entry(unknown, tree.rootFirst, context)).rejects.toThrow(
    "Unknown conversation",
  );
  yield* expect(
    storage.scanEntries({ conversationId: unknown }, 10, undefined, context),
  ).rejects.toThrow("Unknown conversation");
});

const deepForkHistory: StorageCaseSpec = {
  name: "scans deep fork history newest-first through every ancestor cap",
  test: (storage, expect) =>
    Effect.gen(function* () {
      const tree: ForkTree = yield* seedForkTree(storage);
      yield* expectDescendingPages(storage, expect, tree);
      yield* expectAscendingPages(storage, expect, tree);
      const markers = yield* expectHeadMarkers(storage, expect, tree);
      yield* expectMarkerWindows(storage, expect, tree, markers);
      yield* expectEntryLookups(storage, expect, tree);
      yield* expectForkLookups(storage, expect, tree);
    }),
};

export const forksCases: readonly StorageCaseSpec[] = [deepForkHistory];
