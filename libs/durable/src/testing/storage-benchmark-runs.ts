import type { JsonValue } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";

import types from "../types.ts";
import type typesModule from "../types.types.ts";
import type storageBenchmarkRunsTypes from "./storage-benchmark-runs.types.ts";
import storageBenchmark from "./storage-benchmark.ts";
import type storageBenchmarkTypes from "./storage-benchmark.types.ts";

const { ROOT_CONVERSATION_ID } = types;
const { HISTORY_SEGMENT_LENGTH, REPLAY_TAILS, task } = storageBenchmark;

const documentCount = (
  storage: typesModule.Storage,
  id: typesModule.DocumentId,
  at: Parameters<typesModule.Storage["document"]>[1],
): Promise<number> =>
  storage.document(id, at, BACKGROUND_CONTEXT).then((found) => Number(found?.value["count"]));

const entryPage = (
  storage: typesModule.Storage,
  conversationId: storageBenchmarkTypes.StorageBenchmarkDataset["deepestConversationId"],
) =>
  storage
    .scanEntries({ conversationId }, 100, undefined, BACKGROUND_CONTEXT)
    .then((page) => page.items.length);

const STORAGE_READ_BENCHMARKS: readonly storageBenchmarkRunsTypes.StorageReadBenchmark[] = [
  {
    expected: ({ firstEntryId }) => firstEntryId,
    name: "exact entry lookup",
    run: (storage, dataset) =>
      storage
        .entry(dataset.firstEntryId, BACKGROUND_CONTEXT)
        .then((found) => found?.entry.id ?? -1),
  },
  {
    expected: () => 100,
    name: "entry page scan (100)",
    run: (storage) => entryPage(storage, ROOT_CONVERSATION_ID),
  },
  {
    expected: ({ filteredTaskCount }) => filteredTaskCount,
    name: "filtered task scan (50)",
    run: (storage) =>
      storage
        .scanTasks(
          { background: true, kind: "benchmark.filtered", status: "pending" },
          50,
          undefined,
          BACKGROUND_CONTEXT,
        )
        .then((page) => page.items.length),
  },
  {
    expected: ({ exactDocumentId }) => exactDocumentId,
    name: "exact document address among many",
    run: (storage, dataset) =>
      storage
        .findDocument(
          { key: dataset.exactDocumentKey, kind: "benchmark.family", scope: { kind: "session" } },
          "current",
          BACKGROUND_CONTEXT,
        )
        .then((found) => found?.id ?? -1),
  },
  ...REPLAY_TAILS.map((tail): storageBenchmarkRunsTypes.StorageReadBenchmark => ({
    expected: () => tail,
    name: `document replay tail (${tail})`,
    run: (storage, dataset) => documentCount(storage, dataset.replayDocumentIds[tail], "current"),
  })),
  {
    expected: () => HISTORY_SEGMENT_LENGTH,
    name: "ancient historical read before newer base",
    run: (storage, dataset) =>
      documentCount(storage, dataset.historicalDocumentId, dataset.ancientAt),
  },
  {
    expected: () => HISTORY_SEGMENT_LENGTH * 2,
    name: "recent historical read after newer base",
    run: (storage, dataset) =>
      documentCount(storage, dataset.historicalDocumentId, dataset.recentAt),
  },
  {
    expected: () => 100,
    name: "fork-depth history scan (100)",
    run: (storage, dataset) => entryPage(storage, dataset.deepestConversationId),
  },
  {
    expected: ({ ancestorHeadEntryId }) => ancestorHeadEntryId,
    name: "fork-depth head lookup",
    run: (storage, dataset) =>
      storage
        .findLatestHeadMarker(dataset.deepestConversationId, undefined, BACKGROUND_CONTEXT)
        .then((found) => found?.id ?? -1),
  },
];

const commitCount = (
  storage: typesModule.Storage,
  writes: readonly typesModule.StorageWrite[],
): Promise<number> => storage.commit(writes, BACKGROUND_CONTEXT).then(() => writes.length);

const mixedWrites = (
  entryId: typesModule.EntryId,
  taskId: typesModule.TaskId<JsonValue>,
  submissionId: typesModule.SubmissionId,
  documentId: typesModule.DocumentId,
): readonly typesModule.StorageWrite[] => [
  {
    type: "entry",
    value: { conversationId: ROOT_CONVERSATION_ID, id: entryId, kind: "benchmark.mixed" },
  },
  { type: "task", value: task(taskId, taskId) },
  {
    type: "submission",
    value: {
      conversationId: ROOT_CONVERSATION_ID,
      entry: entryId,
      id: submissionId,
      requestId: `benchmark-${submissionId}`,
      status: "done",
      type: "write",
    },
  },
  {
    content: { kind: "base", value: { entryId, taskId }, version: 1 },
    record: {
      id: documentId,
      key: String(documentId),
      kind: "benchmark.mixed",
      scope: { kind: "session" },
    },
    type: "document.create",
  },
];

const STORAGE_WRITE_BENCHMARKS: readonly storageBenchmarkRunsTypes.StorageWriteBenchmark[] = [
  {
    expected: 1,
    name: "commit one entry",
    run: (storage) =>
      storage.mintId<typesModule.EntryId>().then((id) =>
        commitCount(storage, [
          {
            type: "entry",
            value: {
              conversationId: ROOT_CONVERSATION_ID,
              data: { text: "x".repeat(128) },
              id,
              kind: "benchmark.write",
            },
          },
        ]),
      ),
  },
  {
    expected: 100,
    name: "commit 100 entries",
    run: (storage) =>
      Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          storage.mintId<typesModule.EntryId>().then((id): typesModule.StorageWrite => ({
            type: "entry",
            value: {
              conversationId: ROOT_CONVERSATION_ID,
              data: { index, text: "x".repeat(128) },
              id,
              kind: "benchmark.write",
            },
          })),
        ),
      ).then((writes) => commitCount(storage, writes)),
  },
  {
    expected: 4,
    name: "commit mixed entry/task/submission/document",
    run: (storage) =>
      storage
        .mintId<typesModule.EntryId>()
        .then((entryId) =>
          storage
            .mintId<typesModule.TaskId<JsonValue>>()
            .then((taskId) =>
              storage
                .mintId<typesModule.SubmissionId>()
                .then((submissionId) =>
                  storage
                    .mintId<typesModule.DocumentId>()
                    .then((documentId) =>
                      commitCount(storage, mixedWrites(entryId, taskId, submissionId, documentId)),
                    ),
                ),
            ),
        ),
  },
];

const storageBenchmarkRuns = {
  STORAGE_READ_BENCHMARKS,
  STORAGE_WRITE_BENCHMARKS,
};

export default storageBenchmarkRuns;
