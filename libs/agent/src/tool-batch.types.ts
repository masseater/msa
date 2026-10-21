import type aiTypes from "@msa/ai/index.types";
import type { Effect } from "effect";

import type toolCallTypes from "./tool-call.types.ts";
import type typesModule from "./types.ts";

declare namespace toolBatchTypes {
  type Emit = (event: typesModule.AgentEvent) => Effect.Effect<void>;

  type ExecutedToolCallBatch = {
    messages: aiTypes.ToolResultMessage[];
    terminate: boolean;
  };

  interface ToolBatch extends toolCallTypes.ToolCallSite {
    readonly toolCalls: typesModule.AgentToolCall[];
    readonly emit: Emit;
  }

  interface TruncatedToolCalls {
    readonly toolCalls: typesModule.AgentToolCall[];
    readonly emit: Emit;
  }

  interface ToolBatchRequest extends Omit<ToolBatch, "toolCalls"> {
    readonly assistantMessage: aiTypes.AssistantMessage;
    readonly toolExecution: typesModule.ToolExecutionMode | undefined;
  }
}

export type { toolBatchTypes as default };
