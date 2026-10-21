import type compatSchemaTypes from "./providers/compat-schema.types.ts";
import type modelSchemaTypes from "./providers/model-schema.types.ts";
import type openaiCompatSchemaTypes from "./providers/openai-compat-schema.types.ts";
import type typesModule from "./types.types.ts";

declare namespace modelTypesModule {
  interface BaseModel<TApi extends string> {
    id: string;
    name: string;
    api: TApi;
    provider: typesModule.ProviderId;
    baseUrl: string;
    input: modelSchemaTypes.ModelInputModality[];
    inputLimits?: modelSchemaTypes.ModelInputLimits;
    cost: modelSchemaTypes.ModelCost;
    headers?: Record<string, string>;
  }

  interface Model<TApi extends typesModule.Api> extends BaseModel<TApi> {
    type?: "chat";
    reasoning: boolean;
    thinkingLevelMap?: modelSchemaTypes.ThinkingLevelMap;
    promptCache?: modelSchemaTypes.ModelPromptCache;
    contextWindow: number;
    maxTokens: number;
    samplingParams?: typesModule.SamplingParams;
    samplingParamsByThinkingLevel?: typesModule.SamplingParamsByThinkingLevel;
    compat?:
      | (TApi extends "openai-completions"
          ? openaiCompatSchemaTypes.OpenAICompletionsCompat
          : TApi extends "openai-responses" | "openai-codex-responses"
            ? openaiCompatSchemaTypes.OpenAIResponsesCompat
            : TApi extends "anthropic-messages"
              ? compatSchemaTypes.AnthropicMessagesCompat
              : never)
      | undefined;
  }

  interface ImageModel<TApi extends typesModule.ImageApi> extends BaseModel<TApi> {
    type: "image";
    output: ("text" | "image")[];
  }

  interface ClassifierModel<TApi extends typesModule.ClassifierApi> extends BaseModel<TApi> {
    type: "classifier";
    contextWindow: number;
  }

  interface ModelTypeMap {
    chat: Model<typesModule.Api>;
    image: ImageModel<typesModule.ImageApi>;
    classifier: ClassifierModel<typesModule.ClassifierApi>;
  }

  type ModelType = keyof ModelTypeMap;

  type AnyModel = ModelTypeMap[ModelType];
}

export type { modelTypesModule as default };
