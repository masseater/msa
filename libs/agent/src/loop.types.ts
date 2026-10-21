import type toolBatchTypes from "./tool-batch.types.ts";
import type typesModule from "./types.ts";

declare namespace loopTypes {
  interface LoopState {
    context: typesModule.AgentContext;
    config: typesModule.AgentLoopConfig;
    lastCompletedTurn: typesModule.PrepareNextTurnContext | undefined;
    explicitContinuation: boolean;
    pendingMessages: typesModule.AgentMessage[];
    hasMoreToolCalls: boolean;
    readonly newMessages: typesModule.AgentMessage[];
    readonly signal: AbortSignal | undefined;
    readonly emit: toolBatchTypes.Emit;
    readonly streamFunction: typesModule.StreamFn;
  }
}

export type { loopTypes as default };
