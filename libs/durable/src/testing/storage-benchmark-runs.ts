import type { JsonValue } from "@msa/chord";
import { BACKGROUND_CONTEXT } from "@msa/chord/context";

import type { DocumentId, EntryId, Storage, StorageWrite, SubmissionId, TaskId } from "../types.ts";
import { ROOT_CONVERSATION_ID } from "../types.ts";
import {
  HISTORY_SEGMENT_LENGTH,
  REPLAY_TAILS,
  type StorageBenchmarkDataset,
  task,
} from "./storage-benchmark.ts";

export type StorageReadBenchmark = {
  readonly name: string;
  run(storage: Storage, dataset: StorageBenchmarkDataset): Promise<number>;
  expected(dataset: StorageBenchmarkDataset): number;
};

const documentCount = (
  storage: Storage,
  id: DocumentId,
  at: Parameters<Storage["document"]>[1],
): Promise<number> =>
  storage.document(id, at, BACKGROUND_CONTEXT).then((found) => Number(found?.value["count"]));

const entryPage = (
  storage: Storage,
  conversationId: StorageBenchmarkDataset["deepestConversationId"],
) =>
  storage
    .scanEntries({ conversationId }, 100, undefined, BACKGROUND_CONTEXT)
    .then((page) => page.items.length);

export const STORAGE_READ_BENCHMARKS: readonly StorageReadBenchmark[] = [
  {
    name: "exact entry lookup",
    run: (storage, dataset) =>
      storage
        .entry(dataset.firstEntryId, BACKGROUND_CONTEXT)
        .then((found) => found?.entry.id ?? -1),
    expected: ({ firstEntryId }) => firstEntryId,
  },
  {
    name: "entry page scan (100)",
    run: (storage) => entryPage(storage, ROOT_CONVERSATION_ID),
    expected: () => 100,
  },
  {
    name: "filtered task scan (50)",
    run: (storage) =>
      storage
        .scanTasks(
          { kind: "benchmark.filtered", status: "pending", background: true },
          50,
          undefined,
          BACKGROUND_CONTEXT,
        )
        .then((page) => page.items.length),
    expected: ({ filteredTaskCount }) => filteredTaskCount,
  },
  {
    name: "exact document address among many",
    run: (storage, dataset) =>
      storage
        .findDocument(
          { kind: "benchmark.family", key: dataset.exactDocumentKey, scope: { kind: "session" } },
          "current",
          BACKGROUND_CONTEXT,
        )
        .then((found) => found?.id ?? -1),
    expected: ({ exactDocumentId }) => exactDocumentId,
  },
  ...REPLAY_TAILS.map((tail): StorageReadBenchmark => ({
    name: `document replay tail (${tail})`,
    run: (storage, dataset) => documentCount(storage, dataset.replayDocumentIds[tail], "current"),
    expected: () => tail,
  })),
  {
    name: "ancient historical read before newer base",
    run: (storage, dataset) =>
      documentCount(storage, dataset.historicalDocumentId, dataset.ancientAt),
    expected: () => HISTORY_SEGMENT_LENGTH,
  },
  {
    name: "recent historical read after newer base",
    run: (storage, dataset) =>
      documentCount(storage, dataset.historicalDocumentId, dataset.recentAt),
    expected: () => HISTORY_SEGMENT_LENGTH * 2,
  },
  {
    name: "fork-depth history scan (100)",
    run: (storage, dataset) => entryPage(storage, dataset.deepestConversationId),
    expected: () => 100,
  },
  {
    name: "fork-depth head lookup",
    run: (storage, dataset) =>
      storage
        .findLatestHeadMarker(dataset.deepestConversationId, undefined, BACKGROUND_CONTEXT)
        .then((found) => found?.id ?? -1),
    expected: ({ ancestorHeadEntryId }) => ancestorHeadEntryId,
  },
];

export type StorageWriteBenchmark = {
  readonly name: string;
  readonly expected: number;
  run(storage: Storage): Promise<number>;
};

const commitCount = (storage: Storage, writes: readonly StorageWrite[]): Promise<number> =>
  storage.commit(writes, BACKGROUND_CONTEXT).then(() => writes.length);

const mixedWrites = (
  entryId: EntryId,
  taskId: TaskId<JsonValue>,
  submissionId: SubmissionId,
  documentId: DocumentId,
): readonly StorageWrite[] => [
  {
    type: "entry",
    value: { id: entryId, conversationId: ROOT_CONVERSATION_ID, kind: "benchmark.mixed" },
  },
  { type: "task", value: task(taskId, taskId) },
  {
    type: "submission",
    value: {
      id: submissionId,
      conversationId: ROOT_CONVERSATION_ID,
      requestId: `benchmark-${submissionId}`,
      type: "write",
      status: "done",
      entry: entryId,
    },
  },
  {
    type: "document.create",
    record: {
      id: documentId,
      kind: "benchmark.mixed",
      key: String(documentId),
      scope: { kind: "session" },
    },
    content: { kind: "base", version: 1, value: { entryId, taskId } },
  },
];

export const STORAGE_WRITE_BENCHMARKS: readonly StorageWriteBenchmark[] = [
  {
    name: "commit one entry",
    expected: 1,
    run: (storage) =>
      storage.mintId<EntryId>().then((id) =>
        commitCount(storage, [
          {
            type: "entry",
            value: {
              id,
              conversationId: ROOT_CONVERSATION_ID,
              kind: "benchmark.write",
              data: { text: "x".repeat(128) },
            },
          },
        ]),
      ),
  },
  {
    name: "commit 100 entries",
    expected: 100,
    run: (storage) =>
      Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          storage.mintId<EntryId>().then((id): StorageWrite => ({
            type: "entry",
            value: {
              id,
              conversationId: ROOT_CONVERSATION_ID,
              kind: "benchmark.write",
              data: { index, text: "x".repeat(128) },
            },
          })),
        ),
      ).then((writes) => commitCount(storage, writes)),
  },
  {
    name: "commit mixed entry/task/submission/document",
    expected: 4,
    run: (storage) =>
      storage
        .mintId<EntryId>()
        .then((entryId) =>
          storage
            .mintId<TaskId<JsonValue>>()
            .then((taskId) =>
              storage
                .mintId<SubmissionId>()
                .then((submissionId) =>
                  storage
                    .mintId<DocumentId>()
                    .then((documentId) =>
                      commitCount(storage, mixedWrites(entryId, taskId, submissionId, documentId)),
                    ),
                ),
            ),
        ),
  },
];
