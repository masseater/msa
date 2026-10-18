import type { AnthropicMessagesCompat } from "./providers/compat-schema.ts";
import type {
  ModelCost,
  ModelInputLimits,
  ModelInputModality,
  ModelPromptCache,
  ThinkingLevelMap,
} from "./providers/model-schema.ts";
import type {
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
} from "./providers/openai-compat-schema.ts";
import type {
  Api,
  ClassifierApi,
  ImageApi,
  ProviderId,
  SamplingParams,
  SamplingParamsByThinkingLevel,
} from "./types.ts";

export interface BaseModel<TApi extends string> {
  id: string;
  name: string;
  api: TApi;
  provider: ProviderId;
  baseUrl: string;
  input: ModelInputModality[];
  inputLimits?: ModelInputLimits;
  cost: ModelCost;
  headers?: Record<string, string>;
}

export interface Model<TApi extends Api> extends BaseModel<TApi> {
  type?: "chat";
  reasoning: boolean;
  thinkingLevelMap?: ThinkingLevelMap;
  promptCache?: ModelPromptCache;
  contextWindow: number;
  maxTokens: number;
  samplingParams?: SamplingParams;
  samplingParamsByThinkingLevel?: SamplingParamsByThinkingLevel;
  compat?:
    | (TApi extends "openai-completions"
        ? OpenAICompletionsCompat
        : TApi extends "openai-responses" | "openai-codex-responses"
          ? OpenAIResponsesCompat
          : TApi extends "anthropic-messages"
            ? AnthropicMessagesCompat
            : never)
    | undefined;
}

export interface ImageModel<TApi extends ImageApi> extends BaseModel<TApi> {
  type: "image";
  output: ("text" | "image")[];
}

export interface ClassifierModel<TApi extends ClassifierApi> extends BaseModel<TApi> {
  type: "classifier";
  contextWindow: number;
}

export interface ModelTypeMap {
  chat: Model<Api>;
  image: ImageModel<ImageApi>;
  classifier: ClassifierModel<ClassifierApi>;
}

export type ModelType = keyof ModelTypeMap;

export type AnyModel = ModelTypeMap[ModelType];
