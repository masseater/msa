import type {
  AssistantImages,
  ClassifierContext,
  ClassifierResult,
  ImagesContext,
} from "./media-types.ts";
import type { DeferredHandle, TranscriptContext } from "./message-types.ts";
import type { ClassifierModel, ImageModel, Model } from "./model-types.ts";
import type {
  Api,
  ClassifierApi,
  DeferredCancelOptions,
  DeferredFetchOptions,
  ImageApi,
  ProviderRequestOptions,
  SimpleStreamOptions,
  StreamOptions,
} from "./types.ts";
import type { AssistantMessageEventStream } from "./utils/event-stream.ts";

export interface ClassifierOptions extends ProviderRequestOptions<ClassifierModel<ClassifierApi>> {
  temperature?: number;
}

export interface ImagesOptions extends ProviderRequestOptions<ImageModel<ImageApi>> {
  metadata?: Record<string, unknown>;
}

export type ProviderImagesOptions = ImagesOptions & Record<string, unknown>;

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
