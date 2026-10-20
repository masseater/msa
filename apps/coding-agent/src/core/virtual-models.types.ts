import type aiTypes from "@msa/ai/index.types";

declare namespace virtualModelsTypes {
  interface VirtualModelStateData<TState = unknown> {
    provider: string;
    modelId: string;
    state: TState;
  }

  type ModelRouteReason = "user" | "continuation" | "retry" | "direct";

  interface ModelRouteRequest<TState = unknown> {
    model: aiTypes.Model<aiTypes.Api>;
    thinkingLevel: aiTypes.ModelThinkingLevel;
    reason: ModelRouteReason;
    previous?:
      | {
          model: aiTypes.Model<aiTypes.Api>;
          thinkingLevel?: aiTypes.ModelThinkingLevel | undefined;
        }
      | undefined;
    failed?:
      | {
          model: aiTypes.Model<aiTypes.Api>;
          thinkingLevel?: aiTypes.ModelThinkingLevel | undefined;
          message: aiTypes.AssistantMessage;
        }
      | undefined;
    state?: TState;
    messages: readonly aiTypes.Message[];
    signal?: AbortSignal | undefined;
  }

  interface ModelRoute<TState = unknown> {
    model: aiTypes.Model<aiTypes.Api>;
    thinkingLevel: aiTypes.ModelThinkingLevel;
    state?: TState;
  }

  interface VirtualModelDefinition<TState = unknown> {
    provider: string;
    id: string;
    name: string;
    thinkingLevels?: readonly aiTypes.ModelThinkingLevel[];
    contextWindow?: number;
    maxTokens?: number;
    input?: ("text" | "image")[];
    route(request: ModelRouteRequest<TState>): ModelRoute<TState> | Promise<ModelRoute<TState>>;
  }
}

export type { virtualModelsTypes as default };
