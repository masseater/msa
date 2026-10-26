import type aiTypes from "@msa/ai/index.types";

import type agentStateTypes from "./agent-state.types.ts";
import type typesModule from "./types.ts";

declare namespace agentOptionsTypes {
  type ConvertToLlm = (
    messages: typesModule.AgentMessage[],
  ) => aiTypes.Message[] | Promise<aiTypes.Message[]>;

  type TransformContext = (
    messages: typesModule.AgentMessage[],
    signal?: AbortSignal,
  ) => Promise<typesModule.AgentMessage[]>;

  type GetApiKey = (provider: string) => Promise<string | undefined> | string | undefined;

  type BeforeToolCall = (
    context: typesModule.BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<typesModule.BeforeToolCallResult | undefined>;

  type AfterToolCall = (
    context: typesModule.AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<typesModule.AfterToolCallResult | undefined>;

  type PrepareNextTurn = (
    signal?: AbortSignal,
  ) =>
    | Promise<typesModule.AgentLoopTurnUpdate | undefined>
    | typesModule.AgentLoopTurnUpdate
    | undefined;

  type PrepareNextTurnWithContext = (
    context: typesModule.PrepareNextTurnContext,
    signal?: AbortSignal,
  ) =>
    | Promise<typesModule.AgentLoopTurnUpdate | undefined>
    | typesModule.AgentLoopTurnUpdate
    | undefined;

  type FinalizeMessage = (
    message: typesModule.AgentMessage,
    signal: AbortSignal,
  ) => Promise<typesModule.AgentMessage | undefined> | typesModule.AgentMessage | undefined;

  type AgentListener = (event: typesModule.AgentEvent, signal: AbortSignal) => Promise<void> | void;

  interface AgentOptions {
    initialState?: agentStateTypes.AgentInitialState;
    convertToLlm?: ConvertToLlm;
    transformContext?: TransformContext | undefined;
    streamFn: typesModule.StreamFn;
    getApiKey?: GetApiKey;
    onPayload?: aiTypes.SimpleStreamOptions["onPayload"];
    onResponse?: aiTypes.SimpleStreamOptions["onResponse"];
    onProviderStreamEvent?: aiTypes.SimpleStreamOptions["onProviderStreamEvent"];
    beforeToolCall?: BeforeToolCall;
    afterToolCall?: AfterToolCall;
    finalizeMessage?: FinalizeMessage;
    finishTurn?: typesModule.FinishTurn;
    prepareRequest?: typesModule.PrepareRequest;
    prepareNextTurn?: PrepareNextTurn;
    prepareNextTurnWithContext?: PrepareNextTurnWithContext;
    steeringMode?: typesModule.QueueMode;
    followUpMode?: typesModule.QueueMode;
    sessionId?: string;
    thinkingBudgets?: aiTypes.ThinkingBudgets;
    transport?: aiTypes.Transport;
    maxRetryDelayMs?: number;
    toolExecution?: typesModule.ToolExecutionMode;
  }
}

export type { agentOptionsTypes as default };
