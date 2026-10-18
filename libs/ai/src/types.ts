import type { TelemetryContext } from "@msa/telemetry";

import type { OpenAIApiOptionsMap } from "./api-options-openai.ts";
import type { VendorApiOptionsMap } from "./api-options-vendor.ts";
import type { Model } from "./model-types.ts";
import type {
  CacheRetention,
  ModelThinkingLevel,
  ThinkingLevel,
} from "./providers/model-schema.ts";

export type {
  ChatTemplateKwargValue,
  SessionAffinityFormat,
  ThinkingTokenBudgetField,
} from "./providers/compat-fields-schema.ts";
export type {
  AnthropicMessagesCompat,
  BedrockCompat,
  MistralConversationsCompat,
} from "./providers/compat-schema.ts";
export type {
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
} from "./providers/openai-compat-schema.ts";
export type {
  AnthropicAllowedFallbackModel,
  OpenRouterRouting,
  VercelGatewayRouting,
} from "./providers/routing-schema.ts";
export type {
  CacheRetention,
  ModelCost,
  ModelCostRates,
  ModelCostTier,
  ModelImageInputLimits,
  ModelImageResizeOptions,
  ModelInputLimits,
  ModelInputModality,
  ModelPromptCache,
  ModelThinkingLevel,
  ThinkingLevel,
  ThinkingLevelMap,
} from "./providers/model-schema.ts";
export type { AssistantMessageEventStream } from "./utils/event-stream.ts";

export type { IsJsonCompatible, JsonObject, JsonRepresentation, JsonValue } from "./json-types.ts";
export type {
  AssistantImages,
  ClassifierAnswer,
  ClassifierBoolAnswer,
  ClassifierBoolQuestion,
  ClassifierChoiceAnswer,
  ClassifierChoiceQuestion,
  ClassifierContext,
  ClassifierQuestion,
  ClassifierResult,
  ClassifierScoreAnswer,
  ClassifierScoreQuestion,
  ClassifierStopReason,
  ImagesContext,
  ImagesInputContent,
  ImagesOutputContent,
  ImagesStopReason,
} from "./media-types.ts";
export type {
  AssistantMessage,
  AssistantMessageEvent,
  ConstrainedSamplingConfig,
  Context,
  DeferredHandle,
  GrammarFormat,
  GrammarVariants,
  ImageContent,
  Message,
  NestedToolCallRecord,
  NestedToolCalls,
  StopReason,
  SystemMessage,
  TextContent,
  TextSignatureV1,
  ThinkingContent,
  Tool,
  ToolCall,
  ToolReference,
  ToolResultMessage,
  TranscriptContext,
  Usage,
  UserMessage,
} from "./message-types.ts";
export type {
  AnyModel,
  BaseModel,
  ClassifierModel,
  ImageModel,
  Model,
  ModelType,
  ModelTypeMap,
} from "./model-types.ts";
export type {
  ClassifierFunction,
  ClassifierOptions,
  ImagesFunction,
  ImagesOptions,
  ProviderClassifier,
  ProviderImages,
  ProviderImagesOptions,
  ProviderStreams,
  StreamFunction,
} from "./provider-api-types.ts";

export type KnownApi =
  | "openai-completions"
  | "mistral-conversations"
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses"
  | "anthropic-messages"
  | "bedrock-converse-stream"
  | "google-generative-ai"
  | "google-vertex"
  | "msa-messages";

export type Api = KnownApi | (string & {});

export type KnownImageApi = "openrouter-images";

export type ImageApi = KnownImageApi | (string & {});

export type KnownClassifierApi =
  | "typesafe-system-one"
  | "cloudflare-workers-ai-system-one"
  | "llama-cpp-classify"
  | "openai-decisions";

export type ClassifierApi = KnownClassifierApi | (string & {});

export type KnownProvider =
  | "amazon-bedrock"
  | "ant-ling"
  | "anthropic"
  | "google"
  | "google-vertex"
  | "openai"
  | "azure"
  | "openai-codex"
  | "radius"
  | "typesafe"
  | "nvidia"
  | "deepseek"
  | "xai"
  | "groq"
  | "cerebras"
  | "openrouter"
  | "vercel-ai-gateway"
  | "zai"
  | "zai-coding-cn"
  | "mistral"
  | "minimax"
  | "minimax-cn"
  | "moonshotai"
  | "moonshotai-cn"
  | "huggingface"
  | "fireworks"
  | "together"
  | "baseten"
  | "opencode"
  | "opencode-go"
  | "kimi-coding"
  | "meta"
  | "cloudflare-workers-ai"
  | "cloudflare-ai-gateway"
  | "qwen-token-plan"
  | "qwen-token-plan-cn"
  | "qwen-token-plan-individual"
  | "xiaomi"
  | "xiaomi-token-plan-cn"
  | "xiaomi-token-plan-ams"
  | "xiaomi-token-plan-sgp";
export type ProviderId = KnownProvider | string;

export type ToolChoice = "auto" | "none";
export type SamplingParams = Record<string, unknown>;
export type SamplingParamsByThinkingLevel = Partial<Record<ModelThinkingLevel, SamplingParams>>;
export interface ThinkingBudgets {
  minimal?: number;
  low?: number;
  medium?: number;
  high?: number;
}

export type Transport = "sse" | "websocket" | "websocket-cached" | "auto";

export type ProviderEnv = Record<string, string>;
export type ProviderHeaders = Record<string, string | null>;
export type FetchFunction = typeof globalThis.fetch;

export interface ProviderResponse {
  status: number;
  headers: Record<string, string>;
}

export interface ProviderRequestOptions<TModel = Model<Api>> {
  signal?: AbortSignal | undefined;
  telemetryContext?: TelemetryContext | undefined;
  apiKey?: string | undefined;
  fetch?: FetchFunction | undefined;
  env?: ProviderEnv | undefined;
  onPayload?:
    | ((payload: unknown, model: TModel) => unknown | undefined | Promise<unknown | undefined>)
    | undefined;
  onResponse?: ((response: ProviderResponse, model: TModel) => void | Promise<void>) | undefined;
  headers?: ProviderHeaders | undefined;
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  maxRetryDelayMs?: number | undefined;
}

export interface StreamOptions extends ProviderRequestOptions<Model<Api>> {
  onResponse?:
    | ((response: ProviderResponse, model: Model<Api>) => void | Promise<void>)
    | undefined;
  onProviderStreamEvent?: ((data: unknown, model: Model<Api>) => void | Promise<void>) | undefined;
  temperature?: number | undefined;
  samplingParams?: SamplingParams | undefined;
  maxTokens?: number | undefined;
  transport?: Transport | undefined;
  cacheRetention?: CacheRetention | undefined;
  sessionId?: string | undefined;
  websocketConnectTimeoutMs?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export type ProviderStreamOptions = StreamOptions & Record<string, unknown>;

export interface DeferredFetchOptions extends ProviderRequestOptions<Model<Api>> {
  wait?: number;
}

export type DeferredCancelOptions = ProviderRequestOptions<Model<Api>>;

export interface SimpleStreamOptions extends StreamOptions {
  toolChoice?: ToolChoice | undefined;
  reasoning?: ThinkingLevel | undefined;
  deferred?: boolean | { window?: "15m" | "1h" | "24h" } | undefined;
  thinkingBudgets?: ThinkingBudgets | undefined;
}

export interface ApiOptionsMap extends OpenAIApiOptionsMap, VendorApiOptionsMap {}

export type ApiStreamOptions<TApi extends Api> = TApi extends keyof ApiOptionsMap
  ? ApiOptionsMap[TApi]
  : StreamOptions & Record<string, unknown>;
