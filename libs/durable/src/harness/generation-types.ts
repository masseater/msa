import type { DeferredHandle, Message, ModelThinkingLevel } from "@msa/ai";

import type { ToolTaskResult } from "./tool.ts";
import type {
  CompactionResult,
  ConversationStreamOptions,
  EntryId,
  GenerationHooks,
  ModelRef,
  NextTaskState,
  RunningTask,
  TaskId,
  TaskRuntime,
} from "./types.ts";

export type ToolTaskId = TaskId<ToolTaskResult>;

export type GenerationInput = Record<string, never>;

export type GenerationCheckpoint =
  | {
      phase: "prepare";
      attempt: number;
      compacted?: TaskId<CompactionResult>;
      overflow?: string;
      threshold?: true;
    }
  | {
      phase: "request";
      attempt: number;
      compacted?: TaskId<CompactionResult>;
      model: ModelRef;
      thinkingLevel: ModelThinkingLevel;
      streamOptions: ConversationStreamOptions;
      cutoff: EntryId;
    }
  | { phase: "retry"; attempt: number; compacted?: TaskId<CompactionResult>; until: number }
  | {
      phase: "poll";
      attempt: number;
      compacted?: TaskId<CompactionResult>;
      model: ModelRef;
      cutoff: EntryId;
      handle: DeferredHandle;
      pollAt: number;
    }
  | {
      phase: "tools";
      assistant: EntryId;
      tools: TaskId<ToolTaskResult>[];
      pending: string[];
    };

export type GenerationResult = { entryId: EntryId };

export type GenerationRuntime = TaskRuntime<
  GenerationInput,
  GenerationCheckpoint,
  GenerationResult,
  GenerationHooks
>;

export type GenerationNext = NextTaskState<GenerationCheckpoint, GenerationResult>;

export type GenerationRequest = {
  readonly attempt: number;
  readonly compacted: TaskId<CompactionResult> | undefined;
  readonly model: ModelRef;
  readonly cutoff: EntryId;
  readonly messages?: readonly Message[];
  readonly pollAt?: number;
};

export const DEFAULT_POLL_AFTER_MS = 5000;

export type PhaseTask<P extends GenerationCheckpoint["phase"]> = RunningTask<
  GenerationInput,
  Extract<GenerationCheckpoint, { phase: P }>,
  GenerationResult
>;
