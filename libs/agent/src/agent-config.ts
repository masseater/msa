import type { SimpleStreamOptions, ThinkingBudgets, Transport } from "@msa/ai";

import type {
  AfterToolCall,
  BeforeToolCall,
  ConvertToLlm,
  GetApiKey,
  PrepareNextTurn,
  PrepareNextTurnWithContext,
  TransformContext,
} from "./agent-options.ts";
import type { MutableAgentState } from "./agent-state.ts";
import type { PendingMessageQueue } from "./pending-queue.ts";
import type { AgentLoopConfig, FinishTurn, PrepareRequest, ToolExecutionMode } from "./types.ts";

export interface NextTurnHooks {
  readonly prepareNextTurn: PrepareNextTurn | undefined;
  readonly prepareNextTurnWithContext: PrepareNextTurnWithContext | undefined;
}

export interface LoopConfigSource {
  readonly state: MutableAgentState;
  readonly steering: PendingMessageQueue;
  readonly followUps: PendingMessageQueue;
  readonly signal: () => AbortSignal | undefined;
  readonly skipInitialSteeringPoll: boolean;
  readonly sessionId?: string | undefined;
  readonly onPayload?: SimpleStreamOptions["onPayload"];
  readonly onResponse?: SimpleStreamOptions["onResponse"];
  readonly onProviderStreamEvent?: SimpleStreamOptions["onProviderStreamEvent"];
  readonly transport: Transport;
  readonly thinkingBudgets?: ThinkingBudgets | undefined;
  readonly maxRetryDelayMs?: number | undefined;
  readonly toolExecution: ToolExecutionMode;
  readonly beforeToolCall?: BeforeToolCall | undefined;
  readonly afterToolCall?: AfterToolCall | undefined;
  readonly finishTurn?: FinishTurn | undefined;
  readonly prepareRequest?: PrepareRequest | undefined;
  readonly nextTurnHooks: () => NextTurnHooks;
  readonly convertToLlm: ConvertToLlm;
  readonly transformContext?: TransformContext | undefined;
  readonly getApiKey?: GetApiKey | undefined;
}

const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };

const nextTurnHook = (source: LoopConfigSource): AgentLoopConfig["prepareNextTurn"] => {
  const initial = source.nextTurnHooks();
  if (initial.prepareNextTurnWithContext === undefined && initial.prepareNextTurn === undefined) {
    return undefined;
  }
  return (context) => {
    const { prepareNextTurn, prepareNextTurnWithContext } = source.nextTurnHooks();
    if (prepareNextTurnWithContext !== undefined) {
      return prepareNextTurnWithContext(context, source.signal());
    }
    return prepareNextTurn?.(source.signal());
  };
};

export const createLoopConfig = (source: LoopConfigSource): AgentLoopConfig => {
  let skipInitialSteeringPoll = source.skipInitialSteeringPoll;
  const { state } = source;
  return {
    model: state.model,
    ...(state.thinkingLevel === "off" ? {} : { reasoning: state.thinkingLevel }),
    ...optional("sessionId", source.sessionId),
    ...optional("onPayload", source.onPayload),
    ...optional("onResponse", source.onResponse),
    ...optional("onProviderStreamEvent", source.onProviderStreamEvent),
    transport: source.transport,
    ...optional("thinkingBudgets", source.thinkingBudgets),
    ...optional("maxRetryDelayMs", source.maxRetryDelayMs),
    toolExecution: source.toolExecution,
    beforeToolCall: source.beforeToolCall,
    afterToolCall: source.afterToolCall,
    finishTurn: source.finishTurn,
    prepareRequest: source.prepareRequest,
    prepareNextTurn: nextTurnHook(source),
    convertToLlm: source.convertToLlm,
    transformContext: source.transformContext,
    getApiKey: source.getApiKey,
    getSteeringMessages: () => {
      if (skipInitialSteeringPoll) {
        skipInitialSteeringPoll = false;
        return Promise.resolve([]);
      }
      return Promise.resolve(source.steering.drain());
    },
    getFollowUpMessages: () => Promise.resolve(source.followUps.drain()),
  };
};
