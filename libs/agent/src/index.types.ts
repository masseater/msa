import type aiTypes from "@msa/ai/index.types";
import type { TSchema } from "typebox";

import type agentTypesPart1 from "./index-part1.types.ts";
import type agentTypesPart2 from "./index-part2.types.ts";
import type typesModule from "./types.ts";

declare namespace agentTypes {
  type AgentOptions = agentTypesPart1.AgentOptions;
  type AgentInitialState = agentTypesPart1.AgentInitialState;
  type QueueMode = agentTypesPart1.QueueMode;
  type AgentEventSink = agentTypesPart1.AgentEventSink;
  type ToolCallHooks = agentTypesPart1.ToolCallHooks;
  type RunToolCallOptions = agentTypesPart1.RunToolCallOptions;
  type ProxyAssistantMessageEvent = agentTypesPart1.ProxyAssistantMessageEvent;
  type ProxyStreamOptions = agentTypesPart1.ProxyStreamOptions;
  type StreamFn = agentTypesPart1.StreamFn;
  type ToolExecutionMode = agentTypesPart1.ToolExecutionMode;
  type AgentToolCall = agentTypesPart1.AgentToolCall;
  type BeforeToolCallResult = agentTypesPart1.BeforeToolCallResult;
  type AfterToolCallResult = agentTypesPart1.AfterToolCallResult;
  type BeforeToolCallContext = agentTypesPart1.BeforeToolCallContext;
  type AfterToolCallContext = agentTypesPart1.AfterToolCallContext;
  type AgentTurnContext = agentTypesPart1.AgentTurnContext;
  type AgentTurnDecision = agentTypesPart1.AgentTurnDecision;
  type FinishTurn = agentTypesPart1.FinishTurn;
  type AgentLoopTurnUpdate = agentTypesPart1.AgentLoopTurnUpdate;
  type PrepareRequestContext = agentTypesPart1.PrepareRequestContext;
  type AgentRequestUpdate = agentTypesPart1.AgentRequestUpdate;
  type PrepareRequest = agentTypesPart1.PrepareRequest;
  type PrepareNextTurnContext = agentTypesPart1.PrepareNextTurnContext;
  type AgentLoopConfig = agentTypesPart1.AgentLoopConfig;
  type ThinkingLevel = agentTypesPart1.ThinkingLevel;
  type CustomAgentMessages = agentTypesPart1.CustomAgentMessages;
  type AgentMessage = agentTypesPart1.AgentMessage;
  type AgentState = agentTypesPart1.AgentState;
  type AgentToolResult<T = aiTypes.JsonValue | undefined> = typesModule.AgentToolResult<T>;
  type AgentToolCallOutcome = agentTypesPart1.AgentToolCallOutcome;
  type AgentToolUpdateCallback<T = any> = agentTypesPart1.AgentToolUpdateCallback<T>;
  type AgentTool<TParameters extends TSchema = TSchema, TDetails = any> = typesModule.AgentTool<
    TParameters,
    TDetails
  >;
  type AgentContext = agentTypesPart1.AgentContext;
  type AgentEvent = agentTypesPart1.AgentEvent;
  type Agent = agentTypesPart2.Agent;
}

export type { agentTypes as default };
