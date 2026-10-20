import type aiTypes from "@msa/ai/index.types";

import type agentOptionsTypes from "./agent-options.ts";
import type agentStateTypes from "./agent-state.types.ts";
import type pendingQueueTypes from "./pending-queue.types.ts";
import type typesModule from "./types.ts";

declare namespace agentConfigTypes {
  interface NextTurnHooks {
    readonly prepareNextTurn: agentOptionsTypes.PrepareNextTurn | undefined;
    readonly prepareNextTurnWithContext: agentOptionsTypes.PrepareNextTurnWithContext | undefined;
  }

  interface LoopConfigSource {
    readonly state: agentStateTypes.MutableAgentState;
    readonly steering: pendingQueueTypes.PendingMessageQueue;
    readonly followUps: pendingQueueTypes.PendingMessageQueue;
    readonly signal: () => AbortSignal | undefined;
    readonly skipInitialSteeringPoll: boolean;
    readonly sessionId?: string | undefined;
    readonly onPayload?: aiTypes.SimpleStreamOptions["onPayload"];
    readonly onResponse?: aiTypes.SimpleStreamOptions["onResponse"];
    readonly onProviderStreamEvent?: aiTypes.SimpleStreamOptions["onProviderStreamEvent"];
    readonly transport: aiTypes.Transport;
    readonly thinkingBudgets?: aiTypes.ThinkingBudgets | undefined;
    readonly maxRetryDelayMs?: number | undefined;
    readonly toolExecution: typesModule.ToolExecutionMode;
    readonly beforeToolCall?: agentOptionsTypes.BeforeToolCall | undefined;
    readonly afterToolCall?: agentOptionsTypes.AfterToolCall | undefined;
    readonly finishTurn?: typesModule.FinishTurn | undefined;
    readonly prepareRequest?: typesModule.PrepareRequest | undefined;
    readonly nextTurnHooks: () => NextTurnHooks;
    readonly convertToLlm: agentOptionsTypes.ConvertToLlm;
    readonly transformContext?: agentOptionsTypes.TransformContext | undefined;
    readonly getApiKey?: agentOptionsTypes.GetApiKey | undefined;
  }
}

export type { agentConfigTypes as default };
