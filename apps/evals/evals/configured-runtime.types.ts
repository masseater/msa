import type aiTypes from "@msa/ai/index.types";

declare namespace configuredRuntimeTypes {
  type ModelFields = {
    id: string;
    name: string;
    provider: string;
    reasoning: boolean;
    input: Array<"text" | "image">;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
    contextWindow: number;
    maxTokens: number;
  };

  type ProviderRuntimeOutput = {
    result:
      | {
          validRequestReceived: boolean;
          model: ModelFields;
          response: { text: string; stopReason: string; inputTokens: number; outputTokens: number };
        }
      | { error: string };
  };

  type AddedModelOutput = {
    result: { model: ModelFields; existingModelsPreserved: boolean } | { error: string };
  };

  type ProviderScenario = {
    providerId: string;
    modelId: string;
    createContext(): aiTypes.Context;
    options?: aiTypes.ModelsSimpleStreamOptions;
    validRequestReceived(): boolean;
  };
}

export type { configuredRuntimeTypes as default };
