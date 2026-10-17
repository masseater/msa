import type { TelemetryContext } from "@msa/telemetry";

import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import type { AzureOpenAIResponsesOptions } from "./api/azure-openai-responses.ts";
import type { BedrockOptions } from "./api/bedrock-converse-stream.ts";
import type { GoogleOptions } from "./api/google-generative-ai.ts";
import type { GoogleVertexOptions } from "./api/google-vertex.ts";
import type { MistralOptions } from "./api/mistral-conversations.ts";
import type { MsaMessagesOptions } from "./api/msa-messages.ts";
import type { OpenAICodexResponsesOptions } from "./api/openai-codex-responses.ts";
import type { OpenAICompletionsOptions } from "./api/openai-completions.ts";
import type { OpenAIResponsesOptions } from "./api/openai-responses.ts";
import type {
  AnthropicMessagesCompat,
  BedrockCompat,
  MistralConversationsCompat,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
} from "./providers/compat-schema.ts";
import type {
  CacheRetention,
  ModelCost,
  ModelInputLimits,
  ModelInputModality,
  ModelPromptCache,
  ModelThinkingLevel,
  ThinkingLevel,
  ThinkingLevelMap,
} from "./providers/model-schema.ts";
import type { AssistantMessageDiagnostic } from "./utils/diagnostics.ts";
import type { AssistantMessageEventStream } from "./utils/event-stream.ts";

export type {
  AnthropicAllowedFallbackModel,
  AnthropicMessagesCompat,
  BedrockCompat,
  ChatTemplateKwargValue,
  MistralConversationsCompat,
  OpenAICompletionsCompat,
  OpenAIResponsesCompat,
  OpenRouterRouting,
  SessionAffinityFormat,
  ThinkingTokenBudgetField,
  VercelGatewayRouting,
} from "./providers/compat-schema.ts";
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

export interface ApiOptionsMap {
  "anthropic-messages": AnthropicOptions;
  "openai-completions": OpenAICompletionsOptions;
  "openai-responses": OpenAIResponsesOptions;
  "openai-codex-responses": OpenAICodexResponsesOptions;
  "azure-openai-responses": AzureOpenAIResponsesOptions;
  "google-generative-ai": GoogleOptions;
  "google-vertex": GoogleVertexOptions;
  "mistral-conversations": MistralOptions;
  "bedrock-converse-stream": BedrockOptions;
  "msa-messages": MsaMessagesOptions;
}

export type ApiStreamOptions<TApi extends Api> = TApi extends keyof ApiOptionsMap
  ? ApiOptionsMap[TApi]
  : StreamOptions & Record<string, unknown>;

export interface ProviderStreams {
  stream(
    model: Model<Api>,
    context: TranscriptContext,
    options?: StreamOptions,
  ): AssistantMessageEventStream;
  streamSimple(
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
  fetchDeferred?(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: DeferredFetchOptions,
  ): AssistantMessageEventStream;
  cancelDeferred?(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: DeferredCancelOptions,
  ): Promise<void>;
}

export interface ProviderImages {
  generateImages(
    model: ImageModel<ImageApi>,
    context: ImagesContext,
    options?: ImagesOptions,
  ): Promise<AssistantImages>;
}

export interface ProviderClassifier {
  classify(
    model: ClassifierModel<ClassifierApi>,
    context: ClassifierContext,
    options?: ClassifierOptions,
  ): Promise<ClassifierResult>;
}

export interface ClassifierOptions extends ProviderRequestOptions<ClassifierModel<ClassifierApi>> {
  temperature?: number;
}

export interface ImagesOptions extends ProviderRequestOptions<ImageModel<ImageApi>> {
  metadata?: Record<string, unknown>;
}

export type ProviderImagesOptions = ImagesOptions & Record<string, unknown>;

export interface SimpleStreamOptions extends StreamOptions {
  toolChoice?: ToolChoice | undefined;
  reasoning?: ThinkingLevel | undefined;
  deferred?: boolean | { window?: "15m" | "1h" | "24h" } | undefined;
  thinkingBudgets?: ThinkingBudgets | undefined;
}

export type StreamFunction<
  TApi extends Api = Api,
  TOptions extends StreamOptions = StreamOptions,
> = (
  model: Model<TApi>,
  context: TranscriptContext,
  options?: TOptions,
) => AssistantMessageEventStream;

export type ImagesFunction<TOptions extends ImagesOptions = ImagesOptions> = (
  model: ImageModel<ImageApi>,
  context: ImagesContext,
  options?: TOptions,
) => Promise<AssistantImages>;

export type ClassifierFunction<TOptions extends ClassifierOptions = ClassifierOptions> = (
  model: ClassifierModel<ClassifierApi>,
  context: ClassifierContext,
  options?: TOptions,
) => Promise<ClassifierResult>;

export interface TextSignatureV1 {
  v: 1;
  id: string;
  phase?: "commentary" | "final_answer";
}

export interface TextContent {
  type: "text";
  text: string;
  textSignature?: string | undefined;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string | undefined;
  redacted?: boolean;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: JsonObject;
  thoughtSignature?: string | undefined;
  namespace?: string;
  argumentsError?: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h?: number | undefined;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export type StopReason =
  | "pending"
  | "stop"
  | "length"
  | "toolUse"
  | "error"
  | "aborted"
  | "deferred";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsExactlyJsonValue<T> = [T] extends [JsonValue]
  ? [JsonValue] extends [T]
    ? true
    : false
  : false;
type IsJsonProperty<T> =
  IsAny<T> extends true
    ? false
    : unknown extends T
      ? false
      : [Exclude<T, undefined>] extends [never]
        ? true
        : IsJsonCompatible<Exclude<T, undefined>>;
type InvalidJsonKeys<T extends object> = {
  [TKey in keyof T]-?: TKey extends string | number
    ? IsJsonProperty<T[TKey]> extends true
      ? never
      : TKey
    : TKey;
}[keyof T];
type IsJsonCompatible<T> =
  IsAny<T> extends true
    ? false
    : unknown extends T
      ? false
      : IsExactlyJsonValue<T> extends true
        ? true
        : T extends null | boolean | number | string
          ? true
          : T extends undefined
            ? false
            : T extends readonly (infer TItem)[]
              ? IsJsonCompatible<TItem>
              : T extends (...args: never[]) => unknown
                ? false
                : T extends object
                  ? [InvalidJsonKeys<T>] extends [never]
                    ? true
                    : false
                  : false;

export type JsonRepresentation<T> =
  IsAny<T> extends true
    ? JsonValue
    : unknown extends T
      ? JsonValue
      : [T] extends [JsonValue]
        ? T
        : T extends readonly unknown[]
          ? { [TKey in keyof T]: JsonRepresentation<Exclude<T[TKey], undefined>> }
          : T extends object
            ? { [TKey in keyof T]: JsonRepresentation<Exclude<T[TKey], undefined>> }
            : never;

export interface DeferredHandle {
  provider: string;
  modelId: string;
  api: string;
  id: string;
  expiresAt?: number;
  pollAfterMs?: number;
  data?: JsonValue;
}

export interface SystemMessage {
  role: "system";
  content: string | TextContent[];
  sections?: Record<string, string | null>;
  toolsAdded?: Tool[];
  toolsRemoved?: ToolReference[];
  timestamp: number;
}

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: ProviderId;
  model: string;
  responseModel?: string;
  responseId?: string | undefined;
  providerThinkingLevel?: string;
  thinkingLevel?: ModelThinkingLevel;
  diagnostics?: AssistantMessageDiagnostic[];
  usage: Usage;
  stopReason: StopReason;
  deferred?: DeferredHandle;
  errorMessage?: string;
  rawStopReason?: string | undefined;
  endTurn?: boolean;
  timestamp: number;
  durationMs?: number;
}

export interface NestedToolCallRecord {
  id: string;
  name: string;
  arguments?: JsonObject;
  argumentsBytes?: number;
  status: "ok" | "error" | "unfinished";
  durationMs?: number;
  error?: string;
}

export interface NestedToolCalls {
  calls: NestedToolCallRecord[];
  complete: boolean;
}

export type ToolResultMessage<TDetails = JsonValue> =
  IsJsonCompatible<TDetails> extends true
    ? {
        role: "toolResult";
        toolCallId: string;
        toolName: string;
        content: (TextContent | ImageContent)[];
        details?: JsonRepresentation<TDetails>;
        usage?: Usage;
        nestedCalls?: NestedToolCalls;
        isError: boolean;
        timestamp: number;
        durationMs?: number;
      }
    : never;

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;

export type ImagesInputContent = TextContent | ImageContent;
export type ImagesOutputContent = TextContent | ImageContent;

export interface ImagesContext {
  input: ImagesInputContent[];
}

export type ImagesStopReason = "stop" | "error" | "aborted";

export interface AssistantImages {
  api: ImageApi;
  provider: ProviderId;
  model: string;
  output: ImagesOutputContent[];
  responseId?: string;
  usage?: Usage;
  stopReason: ImagesStopReason;
  errorMessage?: string;
  timestamp: number;
}

export interface ClassifierChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface ClassifierScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export interface ClassifierBoolQuestion {
  type: "bool";
  instructions: string;
  criteria: { true: string; false: string };
}

export type ClassifierQuestion =
  | ClassifierChoiceQuestion
  | ClassifierScoreQuestion
  | ClassifierBoolQuestion;

export interface ClassifierContext {
  state: JsonObject;
  images?: ImageContent[];
  questions: Record<string, ClassifierQuestion>;
}

export interface ClassifierChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ClassifierScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
}

export interface ClassifierBoolAnswer {
  type: "bool";
  probability: number;
}

export type ClassifierAnswer =
  | ClassifierChoiceAnswer
  | ClassifierScoreAnswer
  | ClassifierBoolAnswer;
export type ClassifierStopReason = "stop" | "error" | "aborted";

export interface ClassifierResult {
  api: ClassifierApi;
  provider: ProviderId;
  model: string;
  answers: Record<string, ClassifierAnswer>;
  usage?: Usage;
  stopReason: ClassifierStopReason;
  errorMessage?: string;
  timestamp: number;
}

import type { TSchema } from "typebox";

export type GrammarFormat = "openai_lark" | "openai_regex";

export type GrammarVariants = Partial<Record<GrammarFormat, string>>;

export type ConstrainedSamplingConfig =
  | {
      type: "json_schema";
      strict: "prefer" | "require";
    }
  | {
      type: "grammar";
      variants: GrammarVariants;
    };

export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
  constrainedSampling?: false | ConstrainedSamplingConfig | undefined;
}

export interface ToolReference {
  name: string;
}

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

declare const transcriptContextBrand: unique symbol;

export type TranscriptContext = {
  messages: Message[];
  readonly [transcriptContextBrand]: true;
};

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | {
      type: "done";
      reason: Extract<StopReason, "stop" | "length" | "toolUse" | "deferred">;
      message: AssistantMessage;
    }
  | { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };

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
        : TApi extends "openai-responses" | "azure-openai-responses" | "openai-codex-responses"
          ? OpenAIResponsesCompat
          : TApi extends "anthropic-messages"
            ? AnthropicMessagesCompat
            : TApi extends "bedrock-converse-stream"
              ? BedrockCompat
              : TApi extends "mistral-conversations"
                ? MistralConversationsCompat
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
