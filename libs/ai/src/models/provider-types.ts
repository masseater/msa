import type { Credential, ProviderAuth } from "../auth/types.ts";
import type { ModelsStoreEntry } from "../models-store.ts";
import type {
  Api,
  ApiStreamOptions,
  AssistantImages,
  AssistantMessageEventStream,
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
  ClassifierOptions,
  ClassifierResult,
  DeferredCancelOptions,
  DeferredFetchOptions,
  DeferredHandle,
  ImageApi,
  ImageModel,
  ImagesContext,
  ImagesOptions,
  Model,
  ProviderHeaders,
  SimpleStreamOptions,
  TranscriptContext,
} from "../types.ts";

export interface ModelsPublication {
  persist?: ModelsStoreEntry | null;
  update?: () => void;
}

export interface RefreshModelsContext {
  credential?: Credential | undefined;
  stored?: Readonly<ModelsStoreEntry> | undefined;
  publish(publication: ModelsPublication): Promise<boolean>;
  allowNetwork: boolean;
  force?: boolean | undefined;
  signal: AbortSignal;
  baseUrl?: string | undefined;
}

export type ProviderModel<TApi extends Api> =
  | Model<TApi>
  | ImageModel<ImageApi>
  | ClassifierModel<ClassifierApi>;

export interface Provider<TApi extends Api = Api> {
  readonly id: string;
  readonly name: string;

  readonly baseUrl?: string | undefined;
  readonly headers?: ProviderHeaders | undefined;

  readonly auth: ProviderAuth;

  getModels(): readonly Model<TApi>[];

  getAllModels?(): readonly ProviderModel<TApi>[];

  refreshModels?(context: RefreshModelsContext): Promise<void>;

  filterModels?(
    models: readonly Model<TApi>[],
    credential: Credential | undefined,
  ): readonly Model<TApi>[];

  filterAllModels?(
    models: readonly ProviderModel<TApi>[],
    credential: Credential | undefined,
  ): readonly ProviderModel<TApi>[];

  stream<T extends TApi>(
    model: Model<T>,
    context: TranscriptContext,
    options?: ApiStreamOptions<T>,
  ): AssistantMessageEventStream;

  streamSimple(
    model: Model<TApi>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream;
  fetchDeferred?(
    model: Model<TApi>,
    handle: DeferredHandle,
    options?: DeferredFetchOptions,
  ): AssistantMessageEventStream;
  cancelDeferred?(
    model: Model<TApi>,
    handle: DeferredHandle,
    options?: DeferredCancelOptions,
  ): Promise<void>;

  generateImages?(
    model: ImageModel<ImageApi>,
    context: ImagesContext,
    options?: ImagesOptions,
  ): Promise<AssistantImages>;

  classify?(
    model: ClassifierModel<ClassifierApi>,
    context: ClassifierContext,
    options?: ClassifierOptions,
  ): Promise<ClassifierResult>;
}
