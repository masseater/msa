import type { AuthResolutionOverrides } from "../auth/resolve.ts";
import type {
  AuthCheck,
  AuthContext,
  AuthInteraction,
  AuthOperationOptions,
  AuthResult,
  AuthType,
  Credential,
  CredentialStore,
  LoginOptions,
} from "../auth/types.ts";
import type { ModelsStore } from "../models-store.ts";
import type {
  AnyModel,
  Api,
  ApiStreamOptions,
  AssistantImages,
  AssistantMessage,
  AssistantMessageEventStream,
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
  ClassifierOptions,
  ClassifierResult,
  Context,
  DeferredCancelOptions,
  DeferredFetchOptions,
  DeferredHandle,
  ImageApi,
  ImageModel,
  ImagesContext,
  ImagesOptions,
  Model,
  ModelType,
  ModelTypeMap,
  ProviderHeaders,
  SimpleStreamOptions,
} from "../types.ts";
import type { Provider } from "./provider-types.ts";

export interface ModelsRefreshOptions {
  allowNetwork?: boolean;
  providers?: readonly string[];
  force?: boolean;
  signal?: AbortSignal;
}

export interface ModelsRefreshResult {
  aborted: boolean;
  errors: ReadonlyMap<string, Error>;
}

export interface ModelsRequestTransforms {
  transformHeaders?: (headers: ProviderHeaders) => ProviderHeaders | Promise<ProviderHeaders>;
}

export type ModelsApiStreamOptions<TApi extends Api> = ApiStreamOptions<TApi> &
  ModelsRequestTransforms;
export type ModelsSimpleStreamOptions = SimpleStreamOptions & ModelsRequestTransforms;
export type ModelsDeferredFetchOptions = DeferredFetchOptions & ModelsRequestTransforms;
export type ModelsDeferredCancelOptions = DeferredCancelOptions & ModelsRequestTransforms;
export type ModelsImagesOptions = ImagesOptions & ModelsRequestTransforms;
export type ModelsClassifierOptions = ClassifierOptions & ModelsRequestTransforms;

export interface Models {
  getProviders(): readonly Provider[];
  getProvider(id: string): Provider | undefined;

  getModels(provider?: string): readonly Model<Api>[];

  getModel(provider: string, id: string): Model<Api> | undefined;

  getModelsOfType<TType extends ModelType>(
    type: TType,
    provider?: string,
  ): readonly ModelTypeMap[TType][];

  getModelOfType<TType extends ModelType>(
    type: TType,
    provider: string,
    id: string,
  ): ModelTypeMap[TType] | undefined;

  getAllModels(provider?: string): readonly AnyModel[];

  refresh(options?: ModelsRefreshOptions): Promise<ModelsRefreshResult>;

  checkAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthCheck | undefined>;

  getAvailable(providerId?: string, options?: AuthOperationOptions): Promise<readonly Model<Api>[]>;

  getAvailableOfType<TType extends ModelType>(
    type: TType,
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly ModelTypeMap[TType][]>;

  getAllAvailable(
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly AnyModel[]>;

  getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
  getAuth(model: AnyModel, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;

  login(
    providerId: string,
    type: AuthType,
    interaction: AuthInteraction,
    options?: LoginOptions,
  ): Promise<Credential>;

  logout(providerId: string, options?: AuthOperationOptions): Promise<void>;

  stream<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): AssistantMessageEventStream;

  complete<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): Promise<AssistantMessage>;

  streamSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): AssistantMessageEventStream;
  completeSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): Promise<AssistantMessage>;
  streamDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredFetchOptions,
  ): AssistantMessageEventStream;
  fetchDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredFetchOptions,
  ): Promise<AssistantMessage>;
  cancelDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredCancelOptions,
  ): Promise<void>;
  countTokens(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): Promise<number | undefined>;

  generateImages(
    model: ImageModel<ImageApi>,
    context: ImagesContext,
    options?: ModelsImagesOptions,
  ): Promise<AssistantImages>;

  classify(
    model: ClassifierModel<ClassifierApi>,
    context: ClassifierContext,
    options?: ModelsClassifierOptions,
  ): Promise<ClassifierResult>;
}

export interface MutableModels extends Models {
  setProvider(provider: Provider): void;
  deleteProvider(id: string): void;
  clearProviders(): void;
}

export interface CreateModelsOptions {
  credentials?: CredentialStore;
  modelsStore?: ModelsStore;
  authContext?: AuthContext;
}
