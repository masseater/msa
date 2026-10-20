import type { DeferredHandle, Message, ModelThinkingLevel } from "@msa/ai";

import type toolTypes from "./tool.types.ts";
import type typesModule from "./types.types.ts";

declare namespace generationTypesModule {
  type ToolTaskId = typesModule.TaskId<toolTypes.ToolTaskResult>;

  type GenerationInput = Record<string, never>;

  type GenerationCheckpoint =
    | {
        phase: "prepare";
        attempt: number;
        compacted?: typesModule.TaskId<typesModule.CompactionResult>;
        overflow?: string;
        threshold?: true;
      }
    | {
        phase: "request";
        attempt: number;
        compacted?: typesModule.TaskId<typesModule.CompactionResult>;
        model: typesModule.ModelRef;
        thinkingLevel: ModelThinkingLevel;
        streamOptions: typesModule.ConversationStreamOptions;
        cutoff: typesModule.EntryId;
      }
    | {
        phase: "retry";
        attempt: number;
        compacted?: typesModule.TaskId<typesModule.CompactionResult>;
        until: number;
      }
    | {
        phase: "poll";
        attempt: number;
        compacted?: typesModule.TaskId<typesModule.CompactionResult>;
        model: typesModule.ModelRef;
        cutoff: typesModule.EntryId;
        handle: DeferredHandle;
        pollAt: number;
      }
    | {
        phase: "tools";
        assistant: typesModule.EntryId;
        tools: typesModule.TaskId<toolTypes.ToolTaskResult>[];
        pending: string[];
      };

  type GenerationResult = { entryId: typesModule.EntryId };

  type GenerationRuntime = typesModule.TaskRuntime<
    GenerationInput,
    GenerationCheckpoint,
    GenerationResult,
    typesModule.GenerationHooks
  >;

  type GenerationNext = typesModule.NextTaskState<GenerationCheckpoint, GenerationResult>;

  type GenerationRequest = {
    readonly attempt: number;
    readonly compacted: typesModule.TaskId<typesModule.CompactionResult> | undefined;
    readonly model: typesModule.ModelRef;
    readonly cutoff: typesModule.EntryId;
    readonly messages?: readonly Message[];
    readonly pollAt?: number;
  };

  type PhaseTask<P extends GenerationCheckpoint["phase"]> = typesModule.RunningTask<
    GenerationInput,
    Extract<GenerationCheckpoint, { phase: P }>,
    GenerationResult
  >;
}

export type { generationTypesModule as default };
