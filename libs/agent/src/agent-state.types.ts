import type aiTypes from "@msa/ai/index.types";

import type typesModule from "./types.ts";

declare namespace agentStateTypes {
  type MutableAgentState = Omit<
    typesModule.AgentState,
    "isStreaming" | "streamingMessage" | "pendingToolCalls" | "errorMessage"
  > & {
    isStreaming: boolean;
    streamingMessage?: typesModule.AgentMessage | undefined;
    pendingToolCalls: Set<string>;
    errorMessage?: string | undefined;
  };

  type AgentInitialState = Partial<
    Omit<
      typesModule.AgentState,
      "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage"
    >
  >;

  interface PromptInput {
    readonly input: string | typesModule.AgentMessage | typesModule.AgentMessage[];
    readonly images: aiTypes.ImageContent[] | undefined;
  }

  interface RunFailure {
    readonly model: aiTypes.Model<any>;
    readonly error: unknown;
    readonly aborted: boolean;
  }

  interface StateEvent {
    readonly state: MutableAgentState;
    readonly event: typesModule.AgentEvent;
  }
}

export type { agentStateTypes as default };
