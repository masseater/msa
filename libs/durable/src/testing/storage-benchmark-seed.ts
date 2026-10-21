import type chordTypes from "@msa/chord/index.types";
import { Effect, Function } from "effect";

import types from "../types.ts";
import type typesModule from "../types.types.ts";
import rangeModule from "./range.ts";
import storageBenchmarkHistory from "./storage-benchmark-history.ts";
import storageBenchmark from "./storage-benchmark.ts";
import type storageBenchmarkTypes from "./storage-benchmark.types.ts";

const { commit, mint, seedForks, seedHistory } = storageBenchmarkHistory;

const { range, rangeBy } = rangeModule;
const { BATCH_SIZE, REPLAY_TAILS, TIMING_SCALE, task } = storageBenchmark;
const { ROOT_CONVERSATION_ID } = types;
type Minted<I> = { readonly id: I; readonly write: typesModule.StorageWrite };

const seedBatches = Effect.fnUntraced(function* <I extends typesModule.Id<string>>(
  storage: typesModule.Storage,
  count: number,
  make: (index: number) => Effect.Effect<Minted<I>>,
) {
  let first: I | undefined;
  let last: I | undefined;
  for (const start of rangeBy(0, count, BATCH_SIZE)) {
    const writes: typesModule.StorageWrite[] = [];
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

const entry = (storage: typesModule.Storage) => (index: number) =>
  Effect.map(mint<typesModule.EntryId>(storage), (id) => ({
    id,
    write: {
      type: "entry",
      value: {
        conversationId: ROOT_CONVERSATION_ID,
        id,
        kind: "benchmark.entry",
        ...(index === 0 ? { head: id } : {}),
        data: { index, text: `entry-${index}-${"x".repeat(96)}` },
      },
    } satisfies typesModule.StorageWrite,
  }));

const storedTask = (storage: typesModule.Storage) => (index: number) =>
  Effect.map(mint<typesModule.TaskId<chordTypes.JsonValue>>(storage), (id) => ({
    id,
    write: { type: "task", value: task(id, index) } satisfies typesModule.StorageWrite,
  }));

const familyDocument = (storage: typesModule.Storage) => (index: number) =>
  Effect.map(mint<typesModule.DocumentId>(storage), (id) => ({
    id,
    write: {
      content: { kind: "base", value: { index, text: "x".repeat(128) }, version: 1 },
      record: { id, key: `key-${index}`, kind: "benchmark.family", scope: { kind: "session" } },
      type: "document.create",
    } satisfies typesModule.StorageWrite,
  }));

type ReplayEntry = {
  readonly tail: (typeof REPLAY_TAILS)[number];
  readonly id: typesModule.DocumentId;
};

const seedReplays = Effect.fnUntraced(function* (storage: typesModule.Storage) {
  const replayEntries: readonly ReplayEntry[] = yield* Effect.promise(() =>
    Promise.all(
      REPLAY_TAILS.map((tail) =>
        storage.mintId<typesModule.DocumentId>().then((id) => ({ id, tail })),
      ),
    ),
  );
  yield* commit(
    storage,
    replayEntries.map(({ tail, id }) => ({
      content: { kind: "base" as const, value: { count: 0, text: "x".repeat(64) }, version: 1 },
      record: {
        fork: "asOf" as const,
        history: "rewindable" as const,
        id,
        key: String(tail),
        kind: "benchmark.replay",
        scope: { conversationId: ROOT_CONVERSATION_ID, kind: "conversation" as const },
      },
      type: "document.create" as const,
    })),
  );
  for (const count of range(1, Math.max(...REPLAY_TAILS) + 1)) {
    yield* commit(
      storage,
      replayEntries
        .filter(({ tail }) => count <= tail)
        .map(({ id }) => ({
          content: { kind: "delta" as const, ops: [["s", ["count"], count] as const], version: 1 },
          id,
          type: "document.change" as const,
        })),
    );
  }
  return replayEntries;
});
const seed = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  scale: storageBenchmarkTypes.StorageBenchmarkScale,
) {
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
  const dataset: storageBenchmarkTypes.StorageBenchmarkDataset = {
    exactDocumentId,
    exactDocumentKey: `key-${scale.documentCount - 1}`,
    filteredTaskCount: Math.min(50, Math.ceil(scale.taskCount / 60)),
    firstEntryId,
    replayDocumentIds: Object.fromEntries(
      replayEntries.map(({ tail, id }) => [tail, id]),
    ) as Record<(typeof REPLAY_TAILS)[number], typesModule.DocumentId>,
    ...history,
    ancestorHeadEntryId: firstEntryId,
    deepestConversationId,
  };
  return dataset;
});

const isStorage = (args: IArguments): boolean =>
  typeof args[0] === "object" && args[0] !== null && "commit" in args[0];

const seedStorageBenchmark: {
  (
    scale?: storageBenchmarkTypes.StorageBenchmarkScale,
  ): (storage: typesModule.Storage) => Promise<storageBenchmarkTypes.StorageBenchmarkDataset>;
  (
    storage: typesModule.Storage,
    scale?: storageBenchmarkTypes.StorageBenchmarkScale,
  ): Promise<storageBenchmarkTypes.StorageBenchmarkDataset>;
} = Function.dual(
  isStorage,
  (
    storage: typesModule.Storage,
    scale: storageBenchmarkTypes.StorageBenchmarkScale = TIMING_SCALE,
  ) => Effect.runPromise(seed(storage, scale)),
);

const seedStorageWriteBenchmark = (storage: typesModule.Storage): Promise<void> =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* commit(storage, [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }]);
      const writes = yield* Effect.promise(() =>
        Promise.all(
          Array.from({ length: 100 }, (_, index) =>
            storage.mintId<typesModule.EntryId>().then((id) => ({
              type: "entry" as const,
              value: {
                conversationId: ROOT_CONVERSATION_ID,
                data: { index },
                id,
                kind: "benchmark.baseline",
              },
            })),
          ),
        ),
      );
      yield* commit(storage, writes);
    }),
  );

const storageBenchmarkSeed = {
  seedStorageBenchmark,
  seedStorageWriteBenchmark,
};

export default storageBenchmarkSeed;
