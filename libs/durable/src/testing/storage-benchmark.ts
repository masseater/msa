import type chordTypes from "@msa/chord/index.types";
import { Function } from "effect";

import type dualTypes from "../dual.ts";
import types from "../types.ts";
import type typesModule from "../types.types.ts";
import type storageBenchmarkTypes from "./storage-benchmark.types.ts";

const { ROOT_CONVERSATION_ID } = types;

const STORAGE_MEMORY_SCALES: readonly storageBenchmarkTypes.StorageBenchmarkScale[] = [
  { documentCount: 200, entryCount: 1_000, name: "1k", taskCount: 200 },
  { documentCount: 2_000, entryCount: 10_000, name: "10k", taskCount: 2_000 },
];

const TIMING_SCALE: storageBenchmarkTypes.StorageBenchmarkScale = {
  documentCount: 300,
  entryCount: 1_000,
  name: "timing",
  taskCount: 300,
};

const REPLAY_TAILS = [0, 16, 128, 1_024] as const;
const HISTORY_SEGMENT_LENGTH = 128;
const FORK_DEPTH = 8;
const ENTRIES_PER_FORK = 32;
const BATCH_SIZE = 100;

function storageBenchmarkPrimaryRecordCount(
  scale: storageBenchmarkTypes.StorageBenchmarkScale,
): number {
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

const benchmarkTask = (
  id: typesModule.TaskId<chordTypes.JsonValue>,
  index: number,
): storageBenchmarkTypes.StoredTask => {
  const status = index % 3 === 0 ? "pending" : index % 3 === 1 ? "running" : "terminal";
  const common = {
    abortRequested: index % 7 === 0,
    background: index % 5 === 0,
    conversationId: ROOT_CONVERSATION_ID,
    id,
    input: { index },
    kind: index % 4 === 0 ? "benchmark.filtered" : "benchmark.other",
    version: 1,
  };
  if (status === "terminal") {
    return { ...common, state: { outcome: { result: { index }, status: "completed" }, status } };
  }
  return { ...common, state: { checkpoint: { index, payload: "x".repeat(64) }, status } };
};

const task: dualTypes.Dual2<
  typesModule.TaskId<chordTypes.JsonValue>,
  number,
  storageBenchmarkTypes.StoredTask
> = Function.dual(2, benchmarkTask);

const storageBenchmark = {
  BATCH_SIZE,
  ENTRIES_PER_FORK,
  FORK_DEPTH,
  HISTORY_SEGMENT_LENGTH,
  REPLAY_TAILS,
  STORAGE_MEMORY_SCALES,
  TIMING_SCALE,
  storageBenchmarkPrimaryRecordCount,
  task,
};

export default storageBenchmark;
