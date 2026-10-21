import type toolBatchTypes from "./tool-batch.types.ts";
import type typesModule from "./types.ts";

declare namespace loopRunTypes {
  type AgentEventSink = (event: typesModule.AgentEvent) => Promise<void> | void;

  interface LoopRun {
    readonly context: typesModule.AgentContext;
    readonly config: typesModule.AgentLoopConfig;
    readonly emit: toolBatchTypes.Emit;
    readonly signal: AbortSignal | undefined;
    readonly streamFn: typesModule.StreamFn | undefined;
  }

  interface PromptRun extends LoopRun {
    readonly prompts: typesModule.AgentMessage[];
  }
}

export type { loopRunTypes as default };
