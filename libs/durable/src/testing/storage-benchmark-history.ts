import contextModule from "@msa/chord/context";
import { Effect } from "effect";

import types from "../types.ts";
import type typesModule from "../types.types.ts";
import rangeModule from "./range.ts";
import storageBenchmark from "./storage-benchmark.ts";

const { BACKGROUND_CONTEXT } = contextModule;

const { range } = rangeModule;

const { ENTRIES_PER_FORK, FORK_DEPTH, HISTORY_SEGMENT_LENGTH } = storageBenchmark;

const { ROOT_CONVERSATION_ID } = types;

const commit = (
  storage: typesModule.Storage,
  writes: readonly typesModule.StorageWrite[],
): Effect.Effect<typesModule.Seq> =>
  Effect.promise(() => storage.commit(writes, BACKGROUND_CONTEXT));

const mint = <I extends typesModule.Id<string>>(storage: typesModule.Storage): Effect.Effect<I> =>
  Effect.promise(() => storage.mintId<I>());

const countChanges = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  id: typesModule.DocumentId,
  from: number,
  to: number,
) {
  let at: typesModule.Seq | undefined;
  for (const count of range(from, to)) {
    at = yield* commit(storage, [
      {
        content: { kind: "delta", ops: [["s", ["count"], count]], version: 1 },
        id,
        type: "document.change",
      },
    ]);
  }
  return at;
});

const seedHistory = Effect.fnUntraced(function* (storage: typesModule.Storage) {
  const historicalDocumentId = yield* mint<typesModule.DocumentId>(storage);
  const historicalRecord = {
    fork: "asOf",
    history: "rewindable",
    id: historicalDocumentId,
    kind: "benchmark.history",
    scope: { conversationId: ROOT_CONVERSATION_ID, kind: "conversation" },
  } satisfies typesModule.DocumentCreate;
  yield* commit(storage, [
    {
      content: { kind: "base", value: { count: 0 }, version: 1 },
      record: historicalRecord,
      type: "document.create",
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
      content: { kind: "base", value: { count: HISTORY_SEGMENT_LENGTH }, version: 1 },
      id: historicalDocumentId,
      type: "document.change",
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
  return { ancientAt, historicalDocumentId, recentAt };
});

const seedForks = Effect.fnUntraced(function* (
  storage: typesModule.Storage,
  firstEntryId: typesModule.EntryId,
) {
  let parentConversationId = ROOT_CONVERSATION_ID;
  let parentAt = firstEntryId;
  for (const depth of range(0, FORK_DEPTH)) {
    const conversationId = yield* mint<typesModule.ConversationId>(storage);
    yield* commit(storage, [
      {
        type: "conversation",
        value: {
          id: conversationId,
          parent: { at: parentAt, conversationId: parentConversationId },
        },
      },
    ]);
    const ids = yield* Effect.promise(() =>
      Promise.all(
        Array.from({ length: ENTRIES_PER_FORK }, () => storage.mintId<typesModule.EntryId>()),
      ),
    );
    yield* commit(
      storage,
      ids.map((id, index) => ({
        type: "entry" as const,
        value: { conversationId, data: { depth, index }, id, kind: "benchmark.fork" },
      })),
    );
    parentConversationId = conversationId;
    parentAt = ids[ids.length - 1] ?? parentAt;
  }
  return parentConversationId;
});

const storageBenchmarkHistory = { commit, mint, seedForks, seedHistory };

export default storageBenchmarkHistory;
