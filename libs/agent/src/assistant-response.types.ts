import type toolBatchTypes from "./tool-batch.types.ts";
import type typesModule from "./types.ts";

declare namespace assistantResponseTypes {
  interface AssistantRequest {
    readonly context: typesModule.AgentContext;
    readonly config: typesModule.AgentLoopConfig;
    readonly signal: AbortSignal | undefined;
    readonly emit: toolBatchTypes.Emit;
    readonly streamFunction: typesModule.StreamFn;
  }
}

export type { assistantResponseTypes as default };
