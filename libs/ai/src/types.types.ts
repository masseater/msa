import type { TSchema } from "typebox";

import type jsonTypesModule from "./json-types.ts";
import type mediaTypesModule from "./media-types.ts";
import type messageTypesModule from "./message-types.types.ts";
import type modelTypesModule from "./model-types.ts";
import type providerApiTypesModule from "./provider-api-types.ts";
import type providerOptionsTypes from "./provider-options.types.ts";
import type aiTypesSchemaKitTypes from "./types-kit/schema.types.ts";
import type eventStreamTypes from "./utils/event-stream.types.ts";

declare namespace typesModule {
  type KnownApi = providerOptionsTypes.KnownApi;
  type Api = providerOptionsTypes.Api;
  type KnownImageApi = providerOptionsTypes.KnownImageApi;
  type ImageApi = providerOptionsTypes.ImageApi;
  type KnownClassifierApi = providerOptionsTypes.KnownClassifierApi;
  type ClassifierApi = providerOptionsTypes.ClassifierApi;
  type KnownProvider = providerOptionsTypes.KnownProvider;
  type ProviderId = providerOptionsTypes.ProviderId;
  type ToolChoice = providerOptionsTypes.ToolChoice;
  type SamplingParams = providerOptionsTypes.SamplingParams;
  type SamplingParamsByThinkingLevel = providerOptionsTypes.SamplingParamsByThinkingLevel;
  type ThinkingBudgets = providerOptionsTypes.ThinkingBudgets;
  type Transport = providerOptionsTypes.Transport;
  type ProviderEnv = providerOptionsTypes.ProviderEnv;
  type ProviderHeaders = providerOptionsTypes.ProviderHeaders;
  type FetchFunction = providerOptionsTypes.FetchFunction;
  type ProviderResponse = providerOptionsTypes.ProviderResponse;
  type ProviderRequestOptions<TModel = Model<Api>> =
    providerOptionsTypes.ProviderRequestOptions<TModel>;
  type StreamOptions = providerOptionsTypes.StreamOptions;
  type ProviderStreamOptions = providerOptionsTypes.ProviderStreamOptions;
  type DeferredFetchOptions = providerOptionsTypes.DeferredFetchOptions;
  type DeferredCancelOptions = providerOptionsTypes.DeferredCancelOptions;
  type SimpleStreamOptions = providerOptionsTypes.SimpleStreamOptions;
  type ApiOptionsMap = providerOptionsTypes.ApiOptionsMap;
  type ApiStreamOptions<TApi extends Api> = providerOptionsTypes.ApiStreamOptions<TApi>;
  type ChatTemplateKwargValue = aiTypesSchemaKitTypes.ChatTemplateKwargValue;
  type SessionAffinityFormat = aiTypesSchemaKitTypes.SessionAffinityFormat;
  type ThinkingTokenBudgetField = aiTypesSchemaKitTypes.ThinkingTokenBudgetField;
  type AnthropicMessagesCompat = aiTypesSchemaKitTypes.AnthropicMessagesCompat;
  type CacheRetention = aiTypesSchemaKitTypes.CacheRetention;
  type ModelCost = aiTypesSchemaKitTypes.ModelCost;
  type ModelCostRates = aiTypesSchemaKitTypes.ModelCostRates;
  type ModelCostTier = aiTypesSchemaKitTypes.ModelCostTier;
  type ModelImageInputLimits = aiTypesSchemaKitTypes.ModelImageInputLimits;
  type ModelImageResizeOptions = aiTypesSchemaKitTypes.ModelImageResizeOptions;
  type ModelInputLimits = aiTypesSchemaKitTypes.ModelInputLimits;
  type ModelInputModality = aiTypesSchemaKitTypes.ModelInputModality;
  type ModelPromptCache = aiTypesSchemaKitTypes.ModelPromptCache;
  type ModelThinkingLevel = aiTypesSchemaKitTypes.ModelThinkingLevel;
  type ThinkingLevel = aiTypesSchemaKitTypes.ThinkingLevel;
  type ThinkingLevelMap = aiTypesSchemaKitTypes.ThinkingLevelMap;
  type OpenAICompletionsCompat = aiTypesSchemaKitTypes.OpenAICompletionsCompat;
  type OpenAIResponsesCompat = aiTypesSchemaKitTypes.OpenAIResponsesCompat;
  type AnthropicAllowedFallbackModel = aiTypesSchemaKitTypes.AnthropicAllowedFallbackModel;
  type OpenRouterRouting = aiTypesSchemaKitTypes.OpenRouterRouting;
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
  type Tool<TParameters extends TSchema = TSchema> = messageTypesModule.Tool<TParameters>;
  type ToolCall = messageTypesModule.ToolCall;
  type ToolReference = messageTypesModule.ToolReference;
  type ToolResultMessage<TDetails = JsonValue> = messageTypesModule.ToolResultMessage<TDetails>;
  type TranscriptContext = messageTypesModule.TranscriptContext;
  type Usage = messageTypesModule.Usage;
  type UserMessage = messageTypesModule.UserMessage;
  type AnyModel = modelTypesModule.AnyModel;
  type BaseModel<TApi extends string> = modelTypesModule.BaseModel<TApi>;
  type ClassifierModel<TApi extends typesModule.ClassifierApi> =
    modelTypesModule.ClassifierModel<TApi>;
  type ImageModel<TApi extends typesModule.ImageApi> = modelTypesModule.ImageModel<TApi>;
  type Model<TApi extends typesModule.Api> = modelTypesModule.Model<TApi>;
  type ModelType = modelTypesModule.ModelType;
  type ModelTypeMap = modelTypesModule.ModelTypeMap;
  type ClassifierFunction<TOptions extends ClassifierOptions = ClassifierOptions> =
    providerApiTypesModule.ClassifierFunction<TOptions>;
  type ClassifierOptions = providerApiTypesModule.ClassifierOptions;
  type ClassifierModelEvent = providerApiTypesModule.ClassifierModelEvent;
  type ImagesFunction<TOptions extends ImagesOptions = ImagesOptions> =
    providerApiTypesModule.ImagesFunction<TOptions>;
  type ImagesOptions = providerApiTypesModule.ImagesOptions;
  type ProviderClassifier = providerApiTypesModule.ProviderClassifier;
  type ProviderImages = providerApiTypesModule.ProviderImages;
  type ProviderImagesOptions = providerApiTypesModule.ProviderImagesOptions;
  type ProviderStreams = providerApiTypesModule.ProviderStreams;
  type StreamFunction<
    TApi extends typesModule.Api = typesModule.Api,
    TOptions extends typesModule.StreamOptions = typesModule.StreamOptions,
  > = providerApiTypesModule.StreamFunction<TApi, TOptions>;
  type AssistantMessageEventStream = eventStreamTypes.AssistantMessageEventStream;
}

export type { typesModule as default };
