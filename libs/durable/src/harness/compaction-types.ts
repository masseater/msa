import type { ModelThinkingLevel } from "@msa/ai";

import type {
  CompactionHooks,
  CompactionReason,
  CompactionResult,
  ConversationStreamOptions,
  EntryId,
  ModelRef,
  NextTaskState,
  RunningTask,
  TaskId,
  TaskRuntime,
} from "./types.ts";

export type CompactionInput = { reason: CompactionReason; instructions?: string };

export type SummaryRequest = {
  attempt: number;
  model: ModelRef;
  thinkingLevel: ModelThinkingLevel;
  streamOptions: ConversationStreamOptions;
  maxTokens: number;
  tail: EntryId;
  firstKept: EntryId;
};

export type CompactionCheckpoint =
  | { phase: "select" }
  | ({ phase: "summarize" } & SummaryRequest)
  | ({ phase: "retry"; until: number } & SummaryRequest);

export type CompactionRuntime = TaskRuntime<
  CompactionInput,
  CompactionCheckpoint,
  CompactionResult,
  CompactionHooks
>;

export type CompactionNext = NextTaskState<CompactionCheckpoint, CompactionResult>;

export type CompactionTaskId = TaskId<CompactionResult>;

export type CompactionTask = RunningTask<CompactionInput, CompactionCheckpoint, CompactionResult>;
