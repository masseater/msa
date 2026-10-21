import type typesModule from "./types.ts";

declare namespace toolChangesTypes {
  interface PendingMessages {
    readonly context: typesModule.AgentContext;
    readonly messages: typesModule.AgentMessage[];
  }

  interface RequestState {
    readonly config: typesModule.AgentLoopConfig;
    readonly model: typesModule.AgentLoopConfig["model"];
    readonly thinkingLevel: typesModule.ThinkingLevel | undefined;
  }
}

export type { toolChangesTypes as default };
