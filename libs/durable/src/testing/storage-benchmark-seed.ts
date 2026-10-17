import type { JsonValue } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";
import { Effect, Function } from "effect";

import type {
  ConversationId,
  DocumentCreate,
  DocumentId,
  EntryId,
  Id,
  Seq,
  Storage,
  StorageWrite,
  TaskId,
} from "../types.ts";
import { ROOT_CONVERSATION_ID } from "../types.ts";
import { range, rangeBy } from "./range.ts";
import {
  BATCH_SIZE,
  ENTRIES_PER_FORK,
  FORK_DEPTH,
  HISTORY_SEGMENT_LENGTH,
  REPLAY_TAILS,
  type StorageBenchmarkDataset,
  type StorageBenchmarkScale,
  task,
  TIMING_SCALE,
} from "./storage-benchmark.ts";

const commit = (storage: Storage, writes: readonly StorageWrite[]): Effect.Effect<Seq> =>
  Effect.promise(() => storage.commit(writes, BACKGROUND_CONTEXT));

const mint = <I extends Id<string>>(storage: Storage): Effect.Effect<I> =>
  Effect.promise(() => storage.mintId<I>());

type Minted<I> = { readonly id: I; readonly write: StorageWrite };

const seedBatches = Effect.fnUntraced(function* <I extends Id<string>>(
  storage: Storage,
  count: number,
  make: (index: number) => Effect.Effect<Minted<I>>,
) {
  let first: I | undefined;
  let last: I | undefined;
  for (const start of rangeBy(0, count, BATCH_SIZE)) {
    const writes: StorageWrite[] = [];
    for (const index of range(start, Math.min(start + BATCH_SIZE, count))) {
      const { id, write } = yield* make(index);
      if (index === 0) first = id;
      last = id;
      writes.push(write);
    }
    yield* commit(storage, writes);
  }
  return { first, last };
});

const entry = (storage: Storage) => (index: number) =>
  Effect.map(mint<EntryId>(storage), (id) => ({
    id,
    write: {
      type: "entry",
      value: {
        id,
        conversationId: ROOT_CONVERSATION_ID,
        kind: "benchmark.entry",
        ...(index === 0 ? { head: id } : {}),
        data: { index, text: `entry-${index}-${"x".repeat(96)}` },
      },
    } satisfies StorageWrite,
  }));

const storedTask = (storage: Storage) => (index: number) =>
  Effect.map(mint<TaskId<JsonValue>>(storage), (id) => ({
    id,
    write: { type: "task", value: task(id, index) } satisfies StorageWrite,
  }));

const familyDocument = (storage: Storage) => (index: number) =>
  Effect.map(mint<DocumentId>(storage), (id) => ({
    id,
    write: {
      type: "document.create",
      record: { id, kind: "benchmark.family", key: `key-${index}`, scope: { kind: "session" } },
      content: { kind: "base", version: 1, value: { index, text: "x".repeat(128) } },
    } satisfies StorageWrite,
  }));

type ReplayEntry = { readonly tail: (typeof REPLAY_TAILS)[number]; readonly id: DocumentId };

const seedReplays = Effect.fnUntraced(function* (storage: Storage) {
  const replayEntries: readonly ReplayEntry[] = yield* Effect.promise(() =>
    Promise.all(
      REPLAY_TAILS.map((tail) => storage.mintId<DocumentId>().then((id) => ({ tail, id }))),
    ),
  );
  yield* commit(
    storage,
    replayEntries.map(({ tail, id }) => ({
      type: "document.create" as const,
      record: {
        id,
        kind: "benchmark.replay",
        key: String(tail),
        scope: { kind: "conversation" as const, conversationId: ROOT_CONVERSATION_ID },
        history: "rewindable" as const,
        fork: "asOf" as const,
      },
      content: { kind: "base" as const, version: 1, value: { count: 0, text: "x".repeat(64) } },
    })),
  );
  for (const count of range(1, Math.max(...REPLAY_TAILS) + 1)) {
    yield* commit(
      storage,
      replayEntries
        .filter(({ tail }) => count <= tail)
        .map(({ id }) => ({
          type: "document.change" as const,
          id,
          content: { kind: "delta" as const, version: 1, ops: [["s", ["count"], count] as const] },
        })),
    );
  }
  return replayEntries;
});

const countChanges = Effect.fnUntraced(function* (
  storage: Storage,
  id: DocumentId,
  from: number,
  to: number,
) {
  let at: Seq | undefined;
  for (const count of range(from, to)) {
    at = yield* commit(storage, [
      {
        type: "document.change",
        id,
        content: { kind: "delta", version: 1, ops: [["s", ["count"], count]] },
      },
    ]);
  }
  return at;
});

const seedHistory = Effect.fnUntraced(function* (storage: Storage) {
  const historicalDocumentId = yield* mint<DocumentId>(storage);
  const historicalRecord = {
    id: historicalDocumentId,
    kind: "benchmark.history",
    scope: { kind: "conversation", conversationId: ROOT_CONVERSATION_ID },
    history: "rewindable",
    fork: "asOf",
  } satisfies DocumentCreate;
  yield* commit(storage, [
    {
      type: "document.create",
      record: historicalRecord,
      content: { kind: "base", version: 1, value: { count: 0 } },
    },
  ]);
  const ancientAt = yield* countChanges(
    storage,
    historicalDocumentId,
    1,
    HISTORY_SEGMENT_LENGTH + 1,
  );
  yield* commit(storage, [
    {
      type: "document.change",
      id: historicalDocumentId,
      content: { kind: "base", version: 1, value: { count: HISTORY_SEGMENT_LENGTH } },
    },
  ]);
  if (ancientAt === undefined) throw new Error("Benchmark history seed produced no commits");
  const recentAt =
    (yield* countChanges(
      storage,
      historicalDocumentId,
      HISTORY_SEGMENT_LENGTH + 1,
      HISTORY_SEGMENT_LENGTH * 2 + 1,
    )) ?? ancientAt;
  return { historicalDocumentId, ancientAt, recentAt };
});

const seedForks = Effect.fnUntraced(function* (storage: Storage, firstEntryId: EntryId) {
  let parentConversationId = ROOT_CONVERSATION_ID;
  let parentAt = firstEntryId;
  for (const depth of range(0, FORK_DEPTH)) {
    const conversationId = yield* mint<ConversationId>(storage);
    yield* commit(storage, [
      {
        type: "conversation",
        value: {
          id: conversationId,
          parent: { conversationId: parentConversationId, at: parentAt },
        },
      },
    ]);
    const ids = yield* Effect.promise(() =>
      Promise.all(Array.from({ length: ENTRIES_PER_FORK }, () => storage.mintId<EntryId>())),
    );
    yield* commit(
      storage,
      ids.map((id, index) => ({
        type: "entry" as const,
        value: { id, conversationId, kind: "benchmark.fork", data: { depth, index } },
      })),
    );
    parentConversationId = conversationId;
    parentAt = ids[ids.length - 1] ?? parentAt;
  }
  return parentConversationId;
});

const seed = Effect.fnUntraced(function* (storage: Storage, scale: StorageBenchmarkScale) {
  yield* commit(storage, [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }]);
  const { first: firstEntryId } = yield* seedBatches(storage, scale.entryCount, entry(storage));
  yield* seedBatches(storage, scale.taskCount, storedTask(storage));
  const { last: exactDocumentId } = yield* seedBatches(
    storage,
    scale.documentCount,
    familyDocument(storage),
  );
  const replayEntries = yield* seedReplays(storage);
  const history = yield* seedHistory(storage);
  if (firstEntryId === undefined) throw new Error("Benchmark scale must create entries");
  const deepestConversationId = yield* seedForks(storage, firstEntryId);
  if (exactDocumentId === undefined) throw new Error("Benchmark scale must create documents");
  const dataset: StorageBenchmarkDataset = {
    firstEntryId,
    filteredTaskCount: Math.min(50, Math.ceil(scale.taskCount / 60)),
    exactDocumentId,
    exactDocumentKey: `key-${scale.documentCount - 1}`,
    replayDocumentIds: Object.fromEntries(
      replayEntries.map(({ tail, id }) => [tail, id]),
    ) as Record<(typeof REPLAY_TAILS)[number], DocumentId>,
    ...history,
    deepestConversationId,
    ancestorHeadEntryId: firstEntryId,
  };
  return dataset;
});

const isStorage = (args: IArguments): boolean =>
  typeof args[0] === "object" && args[0] !== null && "commit" in args[0];

export const seedStorageBenchmark: {
  (scale?: StorageBenchmarkScale): (storage: Storage) => Promise<StorageBenchmarkDataset>;
  (storage: Storage, scale?: StorageBenchmarkScale): Promise<StorageBenchmarkDataset>;
} = Function.dual(isStorage, (storage: Storage, scale: StorageBenchmarkScale = TIMING_SCALE) =>
  Effect.runPromise(seed(storage, scale)),
);

export const seedStorageWriteBenchmark = (storage: Storage): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* commit(storage, [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }]);
      const writes = yield* Effect.promise(() =>
        Promise.all(
          Array.from({ length: 100 }, (_, index) =>
            storage.mintId<EntryId>().then((id) => ({
              type: "entry" as const,
              value: {
                id,
                conversationId: ROOT_CONVERSATION_ID,
                kind: "benchmark.baseline",
                data: { index },
              },
            })),
          ),
        ),
      );
      yield* commit(storage, writes);
    }),
  );
