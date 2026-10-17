import type { JsonValue } from "@msa/chord";
import { Function } from "effect";

import type { Dual2 } from "../dual.ts";
import type { ConversationId, DocumentId, EntryId, Seq, TaskId, TaskRecord } from "../types.ts";
import { ROOT_CONVERSATION_ID } from "../types.ts";

export type StorageBenchmarkScale = {
  readonly name: string;
  readonly entryCount: number;
  readonly taskCount: number;
  readonly documentCount: number;
};

export const STORAGE_MEMORY_SCALES: readonly StorageBenchmarkScale[] = [
  { name: "1k", entryCount: 1_000, taskCount: 200, documentCount: 200 },
  { name: "10k", entryCount: 10_000, taskCount: 2_000, documentCount: 2_000 },
];

export const TIMING_SCALE: StorageBenchmarkScale = {
  name: "timing",
  entryCount: 1_000,
  taskCount: 300,
  documentCount: 300,
};

export const REPLAY_TAILS = [0, 16, 128, 1_024] as const;
export const HISTORY_SEGMENT_LENGTH = 128;
export const FORK_DEPTH = 8;
export const ENTRIES_PER_FORK = 32;
export const BATCH_SIZE = 100;

export function storageBenchmarkPrimaryRecordCount(scale: StorageBenchmarkScale): number {
  return (
    1 +
    scale.entryCount +
    scale.taskCount +
    scale.documentCount +
    REPLAY_TAILS.length +
    1 +
    FORK_DEPTH * (1 + ENTRIES_PER_FORK)
  );
}

export type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;

export type StorageBenchmarkDataset = {
  readonly firstEntryId: EntryId;
  readonly filteredTaskCount: number;
  readonly exactDocumentId: DocumentId;
  readonly exactDocumentKey: string;
  readonly replayDocumentIds: Readonly<Record<(typeof REPLAY_TAILS)[number], DocumentId>>;
  readonly historicalDocumentId: DocumentId;
  readonly ancientAt: Seq;
  readonly recentAt: Seq;
  readonly deepestConversationId: ConversationId;
  readonly ancestorHeadEntryId: EntryId;
};

const benchmarkTask = (id: TaskId<JsonValue>, index: number): StoredTask => {
  const status = index % 3 === 0 ? "pending" : index % 3 === 1 ? "running" : "terminal";
  const common = {
    id,
    conversationId: ROOT_CONVERSATION_ID,
    kind: index % 4 === 0 ? "benchmark.filtered" : "benchmark.other",
    version: 1,
    input: { index },
    background: index % 5 === 0,
    abortRequested: index % 7 === 0,
  };
  if (status === "terminal") {
    return { ...common, state: { status, outcome: { status: "completed", result: { index } } } };
  }
  return { ...common, state: { status, checkpoint: { index, payload: "x".repeat(64) } } };
};

export const task: Dual2<TaskId<JsonValue>, number, StoredTask> = Function.dual(2, benchmarkTask);
