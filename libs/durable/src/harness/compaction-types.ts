import type aiTypes from "@msa/ai/index.types";

import type typesModule from "./types.types.ts";

declare namespace compactionTypesModule {
  type CompactionInput = { reason: typesModule.CompactionReason; instructions?: string };

  type SummaryRequest = {
    attempt: number;
    model: typesModule.ModelRef;
    thinkingLevel: aiTypes.ModelThinkingLevel;
    streamOptions: typesModule.ConversationStreamOptions;
    maxTokens: number;
    tail: typesModule.EntryId;
    firstKept: typesModule.EntryId;
  };

  type CompactionCheckpoint =
    | { phase: "select" }
    | ({ phase: "summarize" } & SummaryRequest)
    | ({ phase: "retry"; until: number } & SummaryRequest);

  type CompactionRuntime = typesModule.TaskRuntime<
    CompactionInput,
    CompactionCheckpoint,
    typesModule.CompactionResult,
    typesModule.CompactionHooks
  >;

  type CompactionNext = typesModule.NextTaskState<
    CompactionCheckpoint,
    typesModule.CompactionResult
  >;

  type CompactionTaskId = typesModule.TaskId<typesModule.CompactionResult>;

  type CompactionTask = typesModule.RunningTask<
    CompactionInput,
    CompactionCheckpoint,
    typesModule.CompactionResult
  >;
}

export type { compactionTypesModule as default };
