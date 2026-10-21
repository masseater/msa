import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";

import type NestedCallRecorderClass from "./nested-call-recorder.ts";
import type NestedToolCallRunnerClass from "./nested-tool-call-runner.ts";

declare namespace nestedToolCallsTypes {
  interface NestedCallSummary {
    calls: aiTypes.NestedToolCalls | undefined;
    usage: aiTypes.Usage | undefined;
  }

  interface NestedToolCallOptions {
    signal?: AbortSignal | undefined;
    onUpdate?: agentTypes.AgentToolUpdateCallback | undefined;
  }

  type NestedToolExecutionEvent =
    | {
        type: "tool_execution_start";
        toolCallId: string;
        toolName: string;
        args: unknown;
        parentToolCallId: string;
      }
    | {
        type: "tool_execution_update";
        toolCallId: string;
        toolName: string;
        args: unknown;
        partialResult: agentTypes.AgentToolResult<unknown>;
        parentToolCallId: string;
      }
    | {
        type: "tool_execution_end";
        toolCallId: string;
        toolName: string;
        result: agentTypes.AgentToolResult<unknown>;
        isError: boolean;
        durationMs?: number;
        parentToolCallId: string;
      };

  interface NestedToolCallHost {
    getTools(): readonly agentTypes.AgentTool[];
    isSequential(): boolean;
    runToolCall(
      toolCall: agentTypes.AgentToolCall,
      parentToolCallId: string,
      signal: AbortSignal | undefined,
      onUpdate: (partialResult: agentTypes.AgentToolResult<unknown>) => Promise<void>,
    ): Promise<agentTypes.AgentToolCallOutcome>;
    emit(event: NestedToolExecutionEvent): Promise<void>;
  }

  type NestedCallRecorder = (typeof NestedCallRecorderClass)["prototype"];

  type NestedToolCallRunner = (typeof NestedToolCallRunnerClass)["prototype"];
}

export type { nestedToolCallsTypes as default };
