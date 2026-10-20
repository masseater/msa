import type compatTypes from "./compat.types.ts";
import type modelTypesModule from "./model-types.ts";
import type providerApiTypesModule from "./provider-api-types.ts";
import type typesTypes from "./types.types.ts";
import type asyncEventStreamTypes from "./utils/async-event-stream.types.ts";
import type diagnosticsTypes from "./utils/diagnostics.types.ts";
import type eventStreamTypes from "./utils/event-stream.types.ts";
import type retryTypes from "./utils/retry.types.ts";
import type transcriptTypes from "./utils/transcript.types.ts";

declare namespace compatTypesPart5 {
  type AnyModel = modelTypesModule.AnyModel;
  type BaseModel<TApi extends string> = modelTypesModule.BaseModel<TApi>;
  type ClassifierModel<TApi extends compatTypes.ClassifierApi> =
    modelTypesModule.ClassifierModel<TApi>;
  type ImageModel<TApi extends compatTypes.ImageApi> = modelTypesModule.ImageModel<TApi>;
  type Model<TApi extends compatTypes.Api> = modelTypesModule.Model<TApi>;
  type ModelType = modelTypesModule.ModelType;
  type ModelTypeMap = modelTypesModule.ModelTypeMap;
  type ClassifierFunction<
    TOptions extends compatTypes.ClassifierOptions = compatTypes.ClassifierOptions,
  > = providerApiTypesModule.ClassifierFunction<TOptions>;
  type ClassifierOptions = providerApiTypesModule.ClassifierOptions;
  type ImagesFunction<TOptions extends compatTypes.ImagesOptions = compatTypes.ImagesOptions> =
    providerApiTypesModule.ImagesFunction<TOptions>;
  type ImagesOptions = providerApiTypesModule.ImagesOptions;
  type ProviderClassifier = providerApiTypesModule.ProviderClassifier;
  type ProviderImages = providerApiTypesModule.ProviderImages;
  type ProviderImagesOptions = providerApiTypesModule.ProviderImagesOptions;
  type ProviderStreams = providerApiTypesModule.ProviderStreams;
  type StreamFunction<
    TApi extends compatTypes.Api = compatTypes.Api,
    TOptions extends compatTypes.StreamOptions = compatTypes.StreamOptions,
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
  type ProviderRequestOptions<TModel = compatTypes.Model<compatTypes.Api>> =
    typesTypes.ProviderRequestOptions<TModel>;
  type StreamOptions = typesTypes.StreamOptions;
  type ProviderStreamOptions = typesTypes.ProviderStreamOptions;
  type DeferredFetchOptions = typesTypes.DeferredFetchOptions;
  type DeferredCancelOptions = typesTypes.DeferredCancelOptions;
  type SimpleStreamOptions = typesTypes.SimpleStreamOptions;
  type ApiOptionsMap = typesTypes.ApiOptionsMap;
  type ApiStreamOptions<TApi extends compatTypes.Api> = typesTypes.ApiStreamOptions<TApi>;
  type DiagnosticErrorInfo = diagnosticsTypes.DiagnosticErrorInfo;
  type AssistantMessageDiagnostic = diagnosticsTypes.AssistantMessageDiagnostic;
  type EventChannelOptions<T, R> = eventStreamTypes.EventChannelOptions<T, R>;
  type EventChannel<T, R> = eventStreamTypes.EventChannel<T, R>;
  type RetryPolicy = retryTypes.RetryPolicy;
  type RetryCallbacks = retryTypes.RetryCallbacks;
  type TranscriptMessages = transcriptTypes.TranscriptMessages;
  type ToolStateChanges = transcriptTypes.ToolStateChanges;
  type TranscriptTools = transcriptTypes.TranscriptTools;
  type AssistantMessageEventStream = eventStreamTypes.AssistantMessageEventStream;
  type EventStream<T, R = T> = asyncEventStreamTypes.EventStream<T, R>;
}

export type { compatTypesPart5 as default };
