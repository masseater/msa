import type agentLoopTypes from "./agent-loop.types.ts";
import type agentOptionsTypes from "./agent-options.ts";
import type agentStateTypes from "./agent-state.types.ts";
import type loopRunTypes from "./loop-run.types.ts";
import type proxyEventsTypes from "./proxy-events.types.ts";
import type proxyTypes from "./proxy.types.ts";
import type toolCallTypes from "./tool-call.types.ts";
import type typesModule from "./types.ts";

declare namespace agentTypesPart1 {
  type AgentOptions = agentOptionsTypes.AgentOptions;
  type AgentInitialState = agentStateTypes.AgentInitialState;
  type QueueMode = typesModule.QueueMode;
  type AgentEventSink = loopRunTypes.AgentEventSink;
  type ToolCallHooks = toolCallTypes.ToolCallHooks;
  type RunToolCallOptions = agentLoopTypes.RunToolCallOptions;
  type ProxyAssistantMessageEvent = proxyEventsTypes.ProxyAssistantMessageEvent;
  type ProxyStreamOptions = proxyTypes.ProxyStreamOptions;
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
  type AgentToolCallOutcome = typesModule.AgentToolCallOutcome;
  type AgentToolUpdateCallback<T = any> = typesModule.AgentToolUpdateCallback<T>;
  type AgentContext = typesModule.AgentContext;
  type AgentEvent = typesModule.AgentEvent;
}

export type { agentTypesPart1 as default };
