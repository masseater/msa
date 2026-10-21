import type aiTypes from "@msa/ai/index.types";

import type typesModule from "./types.ts";

declare namespace toolCallTypes {
  type ToolCallHooks = Pick<typesModule.AgentLoopConfig, "beforeToolCall" | "afterToolCall">;

  type ToolUpdateSink = (partialResult: typesModule.AgentToolResult<any>) => Promise<void> | void;

  type PreparedToolCall = {
    kind: "prepared";
    toolCall: typesModule.AgentToolCall;
    tool: typesModule.AgentTool<any>;
    args: unknown;
  };

  type ImmediateToolCallOutcome = {
    kind: "immediate";
    result: typesModule.AgentToolResult<any>;
    isError: boolean;
  };

  type ExecutedToolCallOutcome = {
    result: typesModule.AgentToolResult<any>;
    isError: boolean;
    durationMs: number;
  };

  interface ToolCallSite {
    readonly context: typesModule.AgentContext;
    readonly assistantMessage: aiTypes.AssistantMessage;
    readonly hooks: ToolCallHooks;
    readonly signal: AbortSignal | undefined;
  }

  interface ToolCallRequest extends ToolCallSite {
    readonly toolCall: typesModule.AgentToolCall;
    readonly tools?: readonly typesModule.AgentTool<any>[] | undefined;
  }

  interface ToolExecution {
    readonly prepared: PreparedToolCall;
    readonly signal: AbortSignal | undefined;
    readonly onUpdate: ToolUpdateSink;
  }

  interface ToolFinalization extends ToolCallSite {
    readonly prepared: PreparedToolCall;
    readonly executed: ExecutedToolCallOutcome;
  }

  interface ToolRun extends ToolCallSite {
    readonly prepared: PreparedToolCall;
    readonly onUpdate: ToolUpdateSink;
  }
}

export type { toolCallTypes as default };
