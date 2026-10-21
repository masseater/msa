import type aiTypes from "@msa/ai/index.types";
import type { TSchema } from "typebox";

import type agentLoopTypes from "./agent-loop.types.ts";
import type agentOptionsTypes from "./agent-options.ts";
import type agentStateTypes from "./agent-state.types.ts";
import type agentClassTypes from "./agent.types.ts";
import type agentProxyKitTypes from "./index-kit/proxy.types.ts";
import type loopRunTypes from "./loop-run.types.ts";
import type toolCallTypes from "./tool-call.types.ts";
import type typesModule from "./types.ts";

declare namespace agentTypes {
  type AgentOptions = agentOptionsTypes.AgentOptions;
  type AgentInitialState = agentStateTypes.AgentInitialState;
  type QueueMode = typesModule.QueueMode;
  type AgentEventSink = loopRunTypes.AgentEventSink;
  type ToolCallHooks = toolCallTypes.ToolCallHooks;
  type RunToolCallOptions = agentLoopTypes.RunToolCallOptions;
  type ProxyAssistantMessageEvent = agentProxyKitTypes.ProxyAssistantMessageEvent;
  type ProxyStreamOptions = agentProxyKitTypes.ProxyStreamOptions;
  type StreamFn = typesModule.StreamFn;
  type ToolExecutionMode = typesModule.ToolExecutionMode;
  type AgentToolCall = typesModule.AgentToolCall;
  type BeforeToolCallResult = typesModule.BeforeToolCallResult;
  type AfterToolCallResult = typesModule.AfterToolCallResult;
  type BeforeToolCallContext = typesModule.BeforeToolCallContext;
  type AfterToolCallContext = typesModule.AfterToolCallContext;
  type AgentTurnContext = typesModule.AgentTurnContext;
  type AgentTurnDecision = typesModule.AgentTurnDecision;
  type FinishTurn = typesModule.FinishTurn;
  type AgentLoopTurnUpdate = typesModule.AgentLoopTurnUpdate;
  type PrepareRequestContext = typesModule.PrepareRequestContext;
  type AgentRequestUpdate = typesModule.AgentRequestUpdate;
  type PrepareRequest = typesModule.PrepareRequest;
  type PrepareNextTurnContext = typesModule.PrepareNextTurnContext;
  type AgentLoopConfig = typesModule.AgentLoopConfig;
  type ThinkingLevel = typesModule.ThinkingLevel;
  type CustomAgentMessages = typesModule.CustomAgentMessages;
  type AgentMessage = typesModule.AgentMessage;
  type AgentState = typesModule.AgentState;
  type AgentToolResult<T = aiTypes.JsonValue | undefined> = typesModule.AgentToolResult<T>;
  type AgentToolCallOutcome = typesModule.AgentToolCallOutcome;
  type AgentToolUpdateCallback<T = any> = typesModule.AgentToolUpdateCallback<T>;
  type AgentTool<TParameters extends TSchema = TSchema, TDetails = any> = typesModule.AgentTool<
    TParameters,
    TDetails
  >;
  type AgentContext = typesModule.AgentContext;
  type AgentEvent = typesModule.AgentEvent;
  type Agent = agentClassTypes.Agent;
}

export type { agentTypes as default };
