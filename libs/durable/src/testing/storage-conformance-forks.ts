import { Effect } from "effect";

import idsModule from "../ids.ts";
import type typesModule from "../types.types.ts";
import storageConformanceSupport from "./storage-conformance-support.ts";
import type storageConformanceSupportTypes from "./storage-conformance-support.types.ts";

const { commit, context, createRoot, entry, io, mint } = storageConformanceSupport;
const { idFromNumber } = idsModule;

const seedRootAndChild = Effect.fnUntraced(function* (storage: typesModule.Storage) {
  const rootId = yield* createRoot(storage);
  const rootFirst = yield* mint<typesModule.EntryId>(storage);
  const rootForkPoint = yield* mint<typesModule.EntryId>(storage);
  const rootExcludedSameCommit = yield* mint<typesModule.EntryId>(storage);
  const rootEntriesSeq = yield* commit(storage, [
    { type: "entry", value: entry(rootFirst, rootId) },
    { type: "entry", value: entry(rootForkPoint, rootId, "marker", { head: rootFirst }) },
    { type: "entry", value: entry(rootExcludedSameCommit, rootId) },
  ]);
  const childId = yield* mint<typesModule.ConversationId>(storage);
  yield* commit(storage, [
    {
      type: "conversation",
      value: { id: childId, parent: { at: rootForkPoint, conversationId: rootId } },
    },
  ]);
  const childForkPoint = yield* mint<typesModule.EntryId>(storage);
  const childExcluded = yield* mint<typesModule.EntryId>(storage);
  yield* commit(storage, [
    { type: "entry", value: entry(childForkPoint, childId, "note") },
    { type: "entry", value: entry(childExcluded, childId) },
  ]);
  const rootExcludedLater = yield* mint<typesModule.EntryId>(storage);
  yield* commit(storage, [{ type: "entry", value: entry(rootExcludedLater, rootId) }]);
  return {
    childExcluded,
    childForkPoint,
    childId,
    rootEntriesSeq,
    rootExcludedLater,
    rootExcludedSameCommit,
    rootFirst,
    rootForkPoint,
    rootId,
  };
});

type RootAndChild = Effect.Success<ReturnType<typeof seedRootAndChild>>;

const seedForkTree = Effect.fnUntraced(function* (storage: typesModule.Storage) {
  const tree = yield* seedRootAndChild(storage);
  const grandchildId = yield* mint<typesModule.ConversationId>(storage);
  yield* commit(storage, [
    {
      type: "conversation",
      value: {
        id: grandchildId,
        parent: { at: tree.childForkPoint, conversationId: tree.childId },
      },
    },
  ]);
  const grandchildHead = yield* mint<typesModule.EntryId>(storage);
  const grandchildTail = yield* mint<typesModule.EntryId>(storage);
  const grandchildEntriesSeq = yield* commit(storage, [
    {
      type: "entry",
      value: entry(grandchildHead, grandchildId, "marker", { head: grandchildHead }),
    },
    { type: "entry", value: entry(grandchildTail, grandchildId) },
  ]);
  const childExcludedLater = yield* mint<typesModule.EntryId>(storage);
  yield* commit(storage, [{ type: "entry", value: entry(childExcludedLater, tree.childId) }]);
  return {
    ...tree,
    childExcludedLater,
    grandchildEntriesSeq,
    grandchildHead,
    grandchildId,
    grandchildTail,
  };
});

type ForkTree = RootAndChild & {
  readonly grandchildId: typesModule.ConversationId;
  readonly grandchildHead: typesModule.EntryId;
  readonly grandchildTail: typesModule.EntryId;
  readonly grandchildEntriesSeq: typesModule.Seq;
  readonly childExcludedLater: typesModule.EntryId;
};

const scanIds = (
  storage: typesModule.Storage,
  query: typesModule.EntryQuery,
  limit: number,
  cursor: Parameters<typesModule.Storage["scanEntries"]>[2],
) =>
  Effect.map(
    io(() => storage.scanEntries(query, limit, cursor, context)),
    (page) => ({ ids: page.items.map(({ id }) => id), next: page.next }),
  );

const expectDescendingPages = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
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
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
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
  const bounded = { ...ascending, maxEntryId: tree.childForkPoint, minEntryId: tree.rootForkPoint };
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
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
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
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
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
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  tree: ForkTree,
) {
  const seqOf = (id: typesModule.EntryId) =>
    Effect.map(
      io(() => storage.entry(id, context)),
      (found) => found?.commitSeq,
    );
  expect(yield* io(() => storage.entry(tree.rootFirst, context))).toEqual({
    commitSeq: tree.rootEntriesSeq,
    entry: entry(tree.rootFirst, tree.rootId),
  });
  expect(yield* seqOf(tree.rootForkPoint)).toBe(tree.rootEntriesSeq);
  expect(yield* seqOf(tree.grandchildHead)).toBe(tree.grandchildEntriesSeq);
  expect(yield* seqOf(tree.grandchildTail)).toBe(tree.grandchildEntriesSeq);
  expect(
    yield* io(() => storage.entry(idFromNumber<typesModule.EntryId>(999_999), context)),
  ).toBeUndefined();
});

const expectForkLookups = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  expect: storageConformanceSupportTypes.Expect,
  tree: ForkTree,
) {
  const inGrandchild = (id: typesModule.EntryId) =>
    io(() => storage.entry(tree.grandchildId, id, context));
  expect(yield* inGrandchild(tree.rootFirst)).toEqual({
    commitSeq: tree.rootEntriesSeq,
    entry: entry(tree.rootFirst, tree.rootId),
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
  expect(yield* inGrandchild(idFromNumber<typesModule.EntryId>(999_999))).toBeUndefined();
  const unknown = idFromNumber<typesModule.ConversationId>(999_999);
  yield* expect(storage.entry(unknown, tree.rootFirst, context)).rejects.toThrow(
    "Unknown conversation",
  );
  yield* expect(
    storage.scanEntries({ conversationId: unknown }, 10, undefined, context),
  ).rejects.toThrow("Unknown conversation");
});

const deepForkHistory: storageConformanceSupportTypes.StorageCaseSpec = {
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

const forksCases: readonly storageConformanceSupportTypes.StorageCaseSpec[] = [deepForkHistory];

const storageConformanceForks = {
  forksCases,
};

export default storageConformanceForks;
