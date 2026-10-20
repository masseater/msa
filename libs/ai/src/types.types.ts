import type { TSchema } from "typebox";

import type messageTypesModule from "./message-types.types.ts";
import type typesModulePart1 from "./types-part1.types.ts";
import type typesModulePart2 from "./types-part2.types.ts";

declare namespace typesModule {
  type KnownApi = typesModulePart1.KnownApi;
  type Api = typesModulePart1.Api;
  type KnownImageApi = typesModulePart1.KnownImageApi;
  type ImageApi = typesModulePart1.ImageApi;
  type KnownClassifierApi = typesModulePart1.KnownClassifierApi;
  type ClassifierApi = typesModulePart1.ClassifierApi;
  type KnownProvider = typesModulePart1.KnownProvider;
  type ProviderId = typesModulePart1.ProviderId;
  type ToolChoice = typesModulePart1.ToolChoice;
  type SamplingParams = typesModulePart1.SamplingParams;
  type SamplingParamsByThinkingLevel = typesModulePart1.SamplingParamsByThinkingLevel;
  type ThinkingBudgets = typesModulePart1.ThinkingBudgets;
  type Transport = typesModulePart1.Transport;
  type ProviderEnv = typesModulePart1.ProviderEnv;
  type ProviderHeaders = typesModulePart1.ProviderHeaders;
  type FetchFunction = typesModulePart1.FetchFunction;
  type ProviderResponse = typesModulePart1.ProviderResponse;
  type ProviderRequestOptions<TModel = Model<Api>> =
    typesModulePart1.ProviderRequestOptions<TModel>;
  type StreamOptions = typesModulePart1.StreamOptions;
  type ProviderStreamOptions = typesModulePart1.ProviderStreamOptions;
  type DeferredFetchOptions = typesModulePart1.DeferredFetchOptions;
  type DeferredCancelOptions = typesModulePart1.DeferredCancelOptions;
  type SimpleStreamOptions = typesModulePart1.SimpleStreamOptions;
  type ApiOptionsMap = typesModulePart1.ApiOptionsMap;
  type ApiStreamOptions<TApi extends Api> = typesModulePart1.ApiStreamOptions<TApi>;
  type ChatTemplateKwargValue = typesModulePart1.ChatTemplateKwargValue;
  type SessionAffinityFormat = typesModulePart1.SessionAffinityFormat;
  type ThinkingTokenBudgetField = typesModulePart1.ThinkingTokenBudgetField;
  type AnthropicMessagesCompat = typesModulePart1.AnthropicMessagesCompat;
  type CacheRetention = typesModulePart1.CacheRetention;
  type ModelCost = typesModulePart1.ModelCost;
  type ModelCostRates = typesModulePart1.ModelCostRates;
  type ModelCostTier = typesModulePart1.ModelCostTier;
  type ModelImageInputLimits = typesModulePart1.ModelImageInputLimits;
  type ModelImageResizeOptions = typesModulePart1.ModelImageResizeOptions;
  type ModelInputLimits = typesModulePart1.ModelInputLimits;
  type ModelInputModality = typesModulePart1.ModelInputModality;
  type ModelPromptCache = typesModulePart1.ModelPromptCache;
  type ModelThinkingLevel = typesModulePart1.ModelThinkingLevel;
  type ThinkingLevel = typesModulePart1.ThinkingLevel;
  type ThinkingLevelMap = typesModulePart1.ThinkingLevelMap;
  type OpenAICompletionsCompat = typesModulePart1.OpenAICompletionsCompat;
  type OpenAIResponsesCompat = typesModulePart1.OpenAIResponsesCompat;
  type AnthropicAllowedFallbackModel = typesModulePart2.AnthropicAllowedFallbackModel;
  type OpenRouterRouting = typesModulePart2.OpenRouterRouting;
  type IsJsonCompatible<T> = typesModulePart2.IsJsonCompatible<T>;
  type JsonObject = typesModulePart2.JsonObject;
  type JsonRepresentation<T> = typesModulePart2.JsonRepresentation<T>;
  type JsonValue = typesModulePart2.JsonValue;
  type AssistantImages = typesModulePart2.AssistantImages;
  type ClassifierAnswer = typesModulePart2.ClassifierAnswer;
  type ClassifierBoolAnswer = typesModulePart2.ClassifierBoolAnswer;
  type ClassifierBoolQuestion = typesModulePart2.ClassifierBoolQuestion;
  type ClassifierChoiceAnswer = typesModulePart2.ClassifierChoiceAnswer;
  type ClassifierChoiceQuestion = typesModulePart2.ClassifierChoiceQuestion;
  type ClassifierContext = typesModulePart2.ClassifierContext;
  type ClassifierQuestion = typesModulePart2.ClassifierQuestion;
  type ClassifierResult = typesModulePart2.ClassifierResult;
  type ClassifierScoreAnswer = typesModulePart2.ClassifierScoreAnswer;
  type ClassifierScoreQuestion = typesModulePart2.ClassifierScoreQuestion;
  type ClassifierStopReason = typesModulePart2.ClassifierStopReason;
  type ImagesContext = typesModulePart2.ImagesContext;
  type ImagesInputContent = typesModulePart2.ImagesInputContent;
  type ImagesOutputContent = typesModulePart2.ImagesOutputContent;
  type ImagesStopReason = typesModulePart2.ImagesStopReason;
  type AssistantMessage = typesModulePart2.AssistantMessage;
  type AssistantMessageEvent = typesModulePart2.AssistantMessageEvent;
  type ConstrainedSamplingConfig = typesModulePart2.ConstrainedSamplingConfig;
  type Context = typesModulePart2.Context;
  type DeferredHandle = typesModulePart2.DeferredHandle;
  type GrammarFormat = typesModulePart2.GrammarFormat;
  type GrammarVariants = typesModulePart2.GrammarVariants;
  type ImageContent = typesModulePart2.ImageContent;
  type Message = typesModulePart2.Message;
  type NestedToolCallRecord = typesModulePart2.NestedToolCallRecord;
  type NestedToolCalls = typesModulePart2.NestedToolCalls;
  type StopReason = typesModulePart2.StopReason;
  type SystemMessage = typesModulePart2.SystemMessage;
  type TextContent = typesModulePart2.TextContent;
  type TextSignatureV1 = typesModulePart2.TextSignatureV1;
  type ThinkingContent = typesModulePart2.ThinkingContent;
  type Tool<TParameters extends TSchema = TSchema> = messageTypesModule.Tool<TParameters>;
  type ToolCall = typesModulePart2.ToolCall;
  type ToolReference = typesModulePart2.ToolReference;
  type ToolResultMessage<TDetails = JsonValue> = typesModulePart2.ToolResultMessage<TDetails>;
  type TranscriptContext = typesModulePart2.TranscriptContext;
  type Usage = typesModulePart2.Usage;
  type UserMessage = typesModulePart2.UserMessage;
  type AnyModel = typesModulePart1.AnyModel;
  type BaseModel<TApi extends string> = typesModulePart1.BaseModel<TApi>;
  type ClassifierModel<TApi extends typesModule.ClassifierApi> =
    typesModulePart1.ClassifierModel<TApi>;
  type ImageModel<TApi extends typesModule.ImageApi> = typesModulePart1.ImageModel<TApi>;
  type Model<TApi extends typesModule.Api> = typesModulePart1.Model<TApi>;
  type ModelType = typesModulePart1.ModelType;
  type ModelTypeMap = typesModulePart1.ModelTypeMap;
  type ClassifierFunction<TOptions extends ClassifierOptions = ClassifierOptions> =
    typesModulePart2.ClassifierFunction<TOptions>;
  type ClassifierOptions = typesModulePart2.ClassifierOptions;
  type ImagesFunction<TOptions extends ImagesOptions = ImagesOptions> =
    typesModulePart2.ImagesFunction<TOptions>;
  type ImagesOptions = typesModulePart2.ImagesOptions;
  type ProviderClassifier = typesModulePart2.ProviderClassifier;
  type ProviderImages = typesModulePart2.ProviderImages;
  type ProviderImagesOptions = typesModulePart2.ProviderImagesOptions;
  type ProviderStreams = typesModulePart2.ProviderStreams;
  type StreamFunction<
    TApi extends typesModule.Api = typesModule.Api,
    TOptions extends typesModule.StreamOptions = typesModule.StreamOptions,
  > = typesModulePart2.StreamFunction<TApi, TOptions>;
  type AssistantMessageEventStream = typesModulePart2.AssistantMessageEventStream;
}

export type { typesModule as default };
