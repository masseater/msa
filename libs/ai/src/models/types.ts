import type resolveTypes from "../auth/resolve.types.ts";
import type typesModuleModule2 from "../auth/types.ts";
import type modelsStoreTypes from "../models-store.types.ts";
import type typesModuleModule from "../types.types.ts";
import type providerTypesModule from "./provider-types.ts";

declare namespace typesModule {
  interface ModelsRefreshOptions {
    allowNetwork?: boolean;
    providers?: readonly string[];
    force?: boolean;
    signal?: AbortSignal;
  }

  interface ModelsRefreshResult {
    aborted: boolean;
    errors: ReadonlyMap<string, Error>;
  }

  interface ModelsRequestTransforms {
    transformHeaders?: (
      headers: typesModuleModule.ProviderHeaders,
    ) => typesModuleModule.ProviderHeaders | Promise<typesModuleModule.ProviderHeaders>;
  }

  type ModelsApiStreamOptions<TApi extends typesModuleModule.Api> =
    typesModuleModule.ApiStreamOptions<TApi> & ModelsRequestTransforms;

  type ModelsSimpleStreamOptions = typesModuleModule.SimpleStreamOptions & ModelsRequestTransforms;

  type ModelsDeferredFetchOptions = typesModuleModule.DeferredFetchOptions &
    ModelsRequestTransforms;

  type ModelsDeferredCancelOptions = typesModuleModule.DeferredCancelOptions &
    ModelsRequestTransforms;

  type ModelsImagesOptions = typesModuleModule.ImagesOptions & ModelsRequestTransforms;

  type ModelsClassifierOptions = typesModuleModule.ClassifierOptions & ModelsRequestTransforms;

  interface Models {
    getProviders(): readonly providerTypesModule.Provider[];
    getProvider(id: string): providerTypesModule.Provider | undefined;

    getModels(provider?: string): readonly typesModuleModule.Model<typesModuleModule.Api>[];

    getModel(
      provider: string,
      id: string,
    ): typesModuleModule.Model<typesModuleModule.Api> | undefined;

    getModelsOfType<TType extends typesModuleModule.ModelType>(
      type: TType,
      provider?: string,
    ): readonly typesModuleModule.ModelTypeMap[TType][];

    getModelOfType<TType extends typesModuleModule.ModelType>(
      type: TType,
      provider: string,
      id: string,
    ): typesModuleModule.ModelTypeMap[TType] | undefined;

    getAllModels(provider?: string): readonly typesModuleModule.AnyModel[];

    refresh(options?: ModelsRefreshOptions): Promise<ModelsRefreshResult>;

    checkAuth(
      providerId: string,
      options?: typesModuleModule2.AuthOperationOptions,
    ): Promise<typesModuleModule2.AuthCheck | undefined>;

    getAvailable(
      providerId?: string,
      options?: typesModuleModule2.AuthOperationOptions,
    ): Promise<readonly typesModuleModule.Model<typesModuleModule.Api>[]>;

    getAvailableOfType<TType extends typesModuleModule.ModelType>(
      type: TType,
      providerId?: string,
      options?: typesModuleModule2.AuthOperationOptions,
    ): Promise<readonly typesModuleModule.ModelTypeMap[TType][]>;

    getAllAvailable(
      providerId?: string,
      options?: typesModuleModule2.AuthOperationOptions,
    ): Promise<readonly typesModuleModule.AnyModel[]>;

    getAuth(
      providerId: string,
      overrides?: resolveTypes.AuthResolutionOverrides,
    ): Promise<typesModuleModule2.AuthResult | undefined>;
    getAuth(
      model: typesModuleModule.AnyModel,
      overrides?: resolveTypes.AuthResolutionOverrides,
    ): Promise<typesModuleModule2.AuthResult | undefined>;

    login(
      providerId: string,
      type: typesModuleModule2.AuthType,
      interaction: typesModuleModule2.AuthInteraction,
      options?: typesModuleModule2.LoginOptions,
    ): Promise<typesModuleModule2.Credential>;

    logout(providerId: string, options?: typesModuleModule2.AuthOperationOptions): Promise<void>;

    stream<TApi extends typesModuleModule.Api>(
      model: typesModuleModule.Model<TApi>,
      context: typesModuleModule.Context,
      options?: ModelsApiStreamOptions<TApi>,
    ): typesModuleModule.AssistantMessageEventStream;

    complete<TApi extends typesModuleModule.Api>(
      model: typesModuleModule.Model<TApi>,
      context: typesModuleModule.Context,
      options?: ModelsApiStreamOptions<TApi>,
    ): Promise<typesModuleModule.AssistantMessage>;

    streamSimple(
      model: typesModuleModule.Model<typesModuleModule.Api>,
      context: typesModuleModule.Context,
      options?: ModelsSimpleStreamOptions,
    ): typesModuleModule.AssistantMessageEventStream;
    completeSimple(
      model: typesModuleModule.Model<typesModuleModule.Api>,
      context: typesModuleModule.Context,
      options?: ModelsSimpleStreamOptions,
    ): Promise<typesModuleModule.AssistantMessage>;
    streamDeferred(
      model: typesModuleModule.Model<typesModuleModule.Api>,
      handle: typesModuleModule.DeferredHandle,
      options?: ModelsDeferredFetchOptions,
    ): typesModuleModule.AssistantMessageEventStream;
    fetchDeferred(
      model: typesModuleModule.Model<typesModuleModule.Api>,
      handle: typesModuleModule.DeferredHandle,
      options?: ModelsDeferredFetchOptions,
    ): Promise<typesModuleModule.AssistantMessage>;
    cancelDeferred(
      model: typesModuleModule.Model<typesModuleModule.Api>,
      handle: typesModuleModule.DeferredHandle,
      options?: ModelsDeferredCancelOptions,
    ): Promise<void>;
    countTokens(
      model: typesModuleModule.Model<typesModuleModule.Api>,
      context: typesModuleModule.Context,
      options?: ModelsSimpleStreamOptions,
    ): Promise<number | undefined>;

    generateImages(
      model: typesModuleModule.ImageModel<typesModuleModule.ImageApi>,
      context: typesModuleModule.ImagesContext,
      options?: ModelsImagesOptions,
    ): Promise<typesModuleModule.AssistantImages>;

    classify(
      model: typesModuleModule.ClassifierModel<typesModuleModule.ClassifierApi>,
      context: typesModuleModule.ClassifierContext,
      options?: ModelsClassifierOptions,
    ): Promise<typesModuleModule.ClassifierResult>;
  }

  interface MutableModels extends Models {
    setProvider(provider: providerTypesModule.Provider): void;
    deleteProvider(id: string): void;
    clearProviders(): void;
  }

  interface CreateModelsOptions {
    credentials?: typesModuleModule2.CredentialStore;
    modelsStore?: modelsStoreTypes.ModelsStore;
    authContext?: typesModuleModule2.AuthContext;
  }
}

export type { typesModule as default };
