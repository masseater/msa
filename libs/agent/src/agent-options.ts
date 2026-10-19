import type { Message, SimpleStreamOptions, ThinkingBudgets, Transport } from "@msa/ai";

import type { AgentInitialState } from "./agent-state.ts";
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentEvent,
  AgentLoopTurnUpdate,
  AgentMessage,
  BeforeToolCallContext,
  BeforeToolCallResult,
  FinishTurn,
  PrepareNextTurnContext,
  PrepareRequest,
  QueueMode,
  StreamFn,
  ToolExecutionMode,
} from "./types.ts";

export type ConvertToLlm = (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

export type TransformContext = (
  messages: AgentMessage[],
  signal?: AbortSignal,
) => Promise<AgentMessage[]>;

export type GetApiKey = (provider: string) => Promise<string | undefined> | string | undefined;

export type BeforeToolCall = (
  context: BeforeToolCallContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>;

export type AfterToolCall = (
  context: AfterToolCallContext,
  signal?: AbortSignal,
) => Promise<AfterToolCallResult | undefined>;

export type PrepareNextTurn = (
  signal?: AbortSignal,
) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;

export type PrepareNextTurnWithContext = (
  context: PrepareNextTurnContext,
  signal?: AbortSignal,
) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;

export type AgentListener = (event: AgentEvent, signal: AbortSignal) => Promise<void> | void;

export interface AgentOptions {
  initialState?: AgentInitialState;
  convertToLlm?: ConvertToLlm;
  transformContext?: TransformContext | undefined;
  streamFn: StreamFn;
  getApiKey?: GetApiKey;
  onPayload?: SimpleStreamOptions["onPayload"];
  onResponse?: SimpleStreamOptions["onResponse"];
  onProviderStreamEvent?: SimpleStreamOptions["onProviderStreamEvent"];
  beforeToolCall?: BeforeToolCall;
  afterToolCall?: AfterToolCall;
  finishTurn?: FinishTurn;
  prepareRequest?: PrepareRequest;
  prepareNextTurn?: PrepareNextTurn;
  prepareNextTurnWithContext?: PrepareNextTurnWithContext;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  sessionId?: string;
  thinkingBudgets?: ThinkingBudgets;
  transport?: Transport;
  maxRetryDelayMs?: number;
  toolExecution?: ToolExecutionMode;
}
