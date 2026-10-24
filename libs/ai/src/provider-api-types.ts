import type mediaTypesModule from "./media-types.ts";
import type messageTypesModule from "./message-types.types.ts";
import type modelTypesModule from "./model-types.ts";
import type typesModule from "./types.types.ts";
import type eventStreamTypes from "./utils/event-stream.types.ts";

declare namespace providerApiTypesModule {
  interface ClassifierOptions extends typesModule.ProviderRequestOptions<
    modelTypesModule.ClassifierModel<typesModule.ClassifierApi>
  > {
    temperature?: number;
    onModelEvent?: (event: ClassifierModelEvent) => void;
  }

  type ClassifierModelEvent =
    | { readonly type: "download-started"; readonly uri: string }
    | {
        readonly type: "download-progress";
        readonly uri: string;
        readonly downloadedBytes: number;
        readonly totalBytes: number;
      }
    | { readonly type: "ready"; readonly uri: string; readonly path: string }
    | { readonly type: "failed"; readonly uri: string; readonly message: string };

  interface ImagesOptions extends typesModule.ProviderRequestOptions<
    modelTypesModule.ImageModel<typesModule.ImageApi>
  > {
    metadata?: Record<string, unknown>;
  }

  type ProviderImagesOptions = ImagesOptions & Record<string, unknown>;

  interface ProviderStreams {
    stream(
      model: modelTypesModule.Model<typesModule.Api>,
      context: messageTypesModule.TranscriptContext,
      options?: typesModule.StreamOptions,
    ): eventStreamTypes.AssistantMessageEventStream;
    streamSimple(
      model: modelTypesModule.Model<typesModule.Api>,
      context: messageTypesModule.TranscriptContext,
      options?: typesModule.SimpleStreamOptions,
    ): eventStreamTypes.AssistantMessageEventStream;
    fetchDeferred?(
      model: modelTypesModule.Model<typesModule.Api>,
      handle: messageTypesModule.DeferredHandle,
      options?: typesModule.DeferredFetchOptions,
    ): eventStreamTypes.AssistantMessageEventStream;
    cancelDeferred?(
      model: modelTypesModule.Model<typesModule.Api>,
      handle: messageTypesModule.DeferredHandle,
      options?: typesModule.DeferredCancelOptions,
    ): Promise<void>;
    countTokens?(
      model: modelTypesModule.Model<typesModule.Api>,
      context: messageTypesModule.TranscriptContext,
      options?: typesModule.SimpleStreamOptions,
    ): Promise<number>;
  }

  interface ProviderImages {
    generateImages(
      model: modelTypesModule.ImageModel<typesModule.ImageApi>,
      context: mediaTypesModule.ImagesContext,
      options?: ImagesOptions,
    ): Promise<mediaTypesModule.AssistantImages>;
  }

  interface ProviderClassifier {
    classify(
      model: modelTypesModule.ClassifierModel<typesModule.ClassifierApi>,
      context: mediaTypesModule.ClassifierContext,
      options?: ClassifierOptions,
    ): Promise<mediaTypesModule.ClassifierResult>;
  }

  type StreamFunction<
    TApi extends typesModule.Api = typesModule.Api,
    TOptions extends typesModule.StreamOptions = typesModule.StreamOptions,
  > = (
    model: modelTypesModule.Model<TApi>,
    context: messageTypesModule.TranscriptContext,
    options?: TOptions,
  ) => eventStreamTypes.AssistantMessageEventStream;

  type ImagesFunction<TOptions extends ImagesOptions = ImagesOptions> = (
    model: modelTypesModule.ImageModel<typesModule.ImageApi>,
    context: mediaTypesModule.ImagesContext,
    options?: TOptions,
  ) => Promise<mediaTypesModule.AssistantImages>;

  type ClassifierFunction<TOptions extends ClassifierOptions = ClassifierOptions> = (
    model: modelTypesModule.ClassifierModel<typesModule.ClassifierApi>,
    context: mediaTypesModule.ClassifierContext,
    options?: TOptions,
  ) => Promise<mediaTypesModule.ClassifierResult>;
}

export type { providerApiTypesModule as default };
