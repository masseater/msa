import type aiTypes from "@msa/ai/index.types";

import type loopRunTypes from "./loop-run.types.ts";
import type toolCallTypes from "./tool-call.types.ts";
import type typesModule from "./types.ts";

declare namespace agentLoopTypes {
  interface RunToolCallOptions extends toolCallTypes.ToolCallHooks {
    tools: readonly typesModule.AgentTool<any>[];
    assistantMessage: aiTypes.AssistantMessage;
    context: typesModule.AgentContext;
    signal?: AbortSignal;
    onUpdate?: toolCallTypes.ToolUpdateSink;
  }

  type AgentEventSink = loopRunTypes.AgentEventSink;

  type ToolCallHooks = toolCallTypes.ToolCallHooks;
}

export type { agentLoopTypes as default };
