import type aiTypes from "./index.types.ts";
import type jsonTypesModule from "./json-types.ts";
import type mediaTypesModule from "./media-types.ts";
import type messageTypesModule from "./message-types.types.ts";
import type modelTypesModule from "./model-types.ts";
import type providerApiTypesModule from "./provider-api-types.ts";
import type openaiCompatSchemaTypes from "./providers/openai-compat-schema.types.ts";
import type routingSchemaTypes from "./providers/routing-schema.types.ts";
import type typesTypes from "./types.types.ts";

declare namespace aiTypesPart4 {
  type OpenAICompletionsCompat = openaiCompatSchemaTypes.OpenAICompletionsCompat;
  type OpenAIResponsesCompat = openaiCompatSchemaTypes.OpenAIResponsesCompat;
  type AnthropicAllowedFallbackModel = routingSchemaTypes.AnthropicAllowedFallbackModel;
  type OpenRouterRouting = routingSchemaTypes.OpenRouterRouting;
  type IsJsonCompatible<T> = jsonTypesModule.IsJsonCompatible<T>;
  type JsonObject = jsonTypesModule.JsonObject;
  type JsonRepresentation<T> = jsonTypesModule.JsonRepresentation<T>;
  type JsonValue = jsonTypesModule.JsonValue;
  type AssistantImages = mediaTypesModule.AssistantImages;
  type ClassifierAnswer = mediaTypesModule.ClassifierAnswer;
  type ClassifierBoolAnswer = mediaTypesModule.ClassifierBoolAnswer;
  type ClassifierBoolQuestion = mediaTypesModule.ClassifierBoolQuestion;
  type ClassifierChoiceAnswer = mediaTypesModule.ClassifierChoiceAnswer;
  type ClassifierChoiceQuestion = mediaTypesModule.ClassifierChoiceQuestion;
  type ClassifierContext = mediaTypesModule.ClassifierContext;
  type ClassifierQuestion = mediaTypesModule.ClassifierQuestion;
  type ClassifierResult = mediaTypesModule.ClassifierResult;
  type ClassifierScoreAnswer = mediaTypesModule.ClassifierScoreAnswer;
  type ClassifierScoreQuestion = mediaTypesModule.ClassifierScoreQuestion;
  type ClassifierStopReason = mediaTypesModule.ClassifierStopReason;
  type ImagesContext = mediaTypesModule.ImagesContext;
  type ImagesInputContent = mediaTypesModule.ImagesInputContent;
  type ImagesOutputContent = mediaTypesModule.ImagesOutputContent;
  type ImagesStopReason = mediaTypesModule.ImagesStopReason;
  type AssistantMessage = messageTypesModule.AssistantMessage;
  type AssistantMessageEvent = messageTypesModule.AssistantMessageEvent;
  type ConstrainedSamplingConfig = messageTypesModule.ConstrainedSamplingConfig;
  type Context = messageTypesModule.Context;
  type DeferredHandle = messageTypesModule.DeferredHandle;
  type GrammarFormat = messageTypesModule.GrammarFormat;
  type GrammarVariants = messageTypesModule.GrammarVariants;
  type ImageContent = messageTypesModule.ImageContent;
  type Message = messageTypesModule.Message;
  type NestedToolCallRecord = messageTypesModule.NestedToolCallRecord;
  type NestedToolCalls = messageTypesModule.NestedToolCalls;
  type StopReason = messageTypesModule.StopReason;
  type SystemMessage = messageTypesModule.SystemMessage;
  type TextContent = messageTypesModule.TextContent;
  type TextSignatureV1 = messageTypesModule.TextSignatureV1;
  type ThinkingContent = messageTypesModule.ThinkingContent;
  type Tool<TParameters extends aiTypes.TSchema = aiTypes.TSchema> =
    messageTypesModule.Tool<TParameters>;
  type ToolCall = messageTypesModule.ToolCall;
  type ToolReference = messageTypesModule.ToolReference;
  type ToolResultMessage<TDetails = aiTypes.JsonValue> =
    messageTypesModule.ToolResultMessage<TDetails>;
  type TranscriptContext = messageTypesModule.TranscriptContext;
  type Usage = messageTypesModule.Usage;
  type UserMessage = messageTypesModule.UserMessage;
  type AnyModel = modelTypesModule.AnyModel;
  type BaseModel<TApi extends string> = modelTypesModule.BaseModel<TApi>;
  type ClassifierModel<TApi extends aiTypes.ClassifierApi> = modelTypesModule.ClassifierModel<TApi>;
  type ImageModel<TApi extends aiTypes.ImageApi> = modelTypesModule.ImageModel<TApi>;
  type Model<TApi extends aiTypes.Api> = modelTypesModule.Model<TApi>;
  type ModelType = modelTypesModule.ModelType;
  type ModelTypeMap = modelTypesModule.ModelTypeMap;
  type ClassifierFunction<TOptions extends aiTypes.ClassifierOptions = aiTypes.ClassifierOptions> =
    providerApiTypesModule.ClassifierFunction<TOptions>;
  type ClassifierOptions = providerApiTypesModule.ClassifierOptions;
  type ImagesFunction<TOptions extends aiTypes.ImagesOptions = aiTypes.ImagesOptions> =
    providerApiTypesModule.ImagesFunction<TOptions>;
  type ImagesOptions = providerApiTypesModule.ImagesOptions;
  type ProviderClassifier = providerApiTypesModule.ProviderClassifier;
  type ProviderImages = providerApiTypesModule.ProviderImages;
  type ProviderImagesOptions = providerApiTypesModule.ProviderImagesOptions;
  type ProviderStreams = providerApiTypesModule.ProviderStreams;
  type StreamFunction<
    TApi extends aiTypes.Api = aiTypes.Api,
    TOptions extends aiTypes.StreamOptions = aiTypes.StreamOptions,
  > = providerApiTypesModule.StreamFunction<TApi, TOptions>;
  type KnownApi = typesTypes.KnownApi;
  type Api = typesTypes.Api;
  type KnownImageApi = typesTypes.KnownImageApi;
  type ImageApi = typesTypes.ImageApi;
  type KnownClassifierApi = typesTypes.KnownClassifierApi;
  type ClassifierApi = typesTypes.ClassifierApi;
  type KnownProvider = typesTypes.KnownProvider;
  type ProviderId = typesTypes.ProviderId;
  type ToolChoice = typesTypes.ToolChoice;
  type SamplingParams = typesTypes.SamplingParams;
  type SamplingParamsByThinkingLevel = typesTypes.SamplingParamsByThinkingLevel;
  type ThinkingBudgets = typesTypes.ThinkingBudgets;
  type Transport = typesTypes.Transport;
  type ProviderEnv = typesTypes.ProviderEnv;
  type ProviderHeaders = typesTypes.ProviderHeaders;
  type FetchFunction = typesTypes.FetchFunction;
  type ProviderResponse = typesTypes.ProviderResponse;
  type ProviderRequestOptions<TModel = aiTypes.Model<aiTypes.Api>> =
    typesTypes.ProviderRequestOptions<TModel>;
  type StreamOptions = typesTypes.StreamOptions;
  type ProviderStreamOptions = typesTypes.ProviderStreamOptions;
  type DeferredFetchOptions = typesTypes.DeferredFetchOptions;
  type DeferredCancelOptions = typesTypes.DeferredCancelOptions;
  type SimpleStreamOptions = typesTypes.SimpleStreamOptions;
  type ApiOptionsMap = typesTypes.ApiOptionsMap;
  type ApiStreamOptions<TApi extends aiTypes.Api> = typesTypes.ApiStreamOptions<TApi>;
}

export type { aiTypesPart4 as default };
