import { Effect } from "effect";

import type resolveTypes from "./auth/resolve.types.ts";
import type typesModule from "./auth/types.ts";
import modelsKit from "./models-kit.ts";
import modelsParts from "./models-parts.ts";
import type modelsStateTypes from "./models-state.types.ts";
import type providerTypesModule from "./models/provider-types.ts";
import type typesModuleModule from "./models/types.ts";
import type typesModuleModule2 from "./types.types.ts";

const {
  modelsAuth,
  modelsAuthApply,
  modelsCatalogQuery,
  modelsCost,
  modelsProvider,
  modelsRefresh,
  modelsStream,
} = modelsParts;
const {
  cancelDeferred,
  classify,
  countModelTokens,
  generateImages,
  streamDeferred,
  streamModel,
  streamModelSimple,
} = modelsStream;
const { refreshModels, supersedeProviderRefresh } = modelsRefresh;
const { login, logout } = modelsAuthApply;
const { checkAuth, getAllAvailable, getAuth, getAvailable } = modelsAuth;
const { createProvider } = modelsProvider;
const { listAllModels, listModels, ofType } = modelsCatalogQuery;
const { calculateCost, clampThinkingLevel, getSupportedThinkingLevels, hasApi, modelsAreEqual } =
  modelsCost;
const {
  context: contextModule,
  credentialStore,
  modelOperations,
  modelsError,
  InMemoryModelsStore,
} = modelsKit;
const { defaultProviderAuthContext } = contextModule;
const { InMemoryCredentialStore } = credentialStore;
const createModelsState = (
  options?: typesModuleModule.CreateModelsOptions,
): modelsStateTypes.ModelsState => ({
  authContext: options?.authContext ?? defaultProviderAuthContext(),
  credentials: options?.credentials ?? new InMemoryCredentialStore(),
  modelsStore: options?.modelsStore ?? new InMemoryModelsStore(),
  providers: new Map(),
  publicationChains: new Map(),
  refreshControllers: new Map(),
  refreshGenerations: new Map(),
});

class ModelsImpl implements typesModuleModule.MutableModels {
  private readonly state: modelsStateTypes.ModelsState;

  constructor(options?: typesModuleModule.CreateModelsOptions) {
    this.state = createModelsState(options);
  }

  setProvider(provider: providerTypesModule.Provider): void {
    supersedeProviderRefresh({ providerId: provider.id, state: this.state });
    this.state.providers.set(provider.id, provider);
  }

  deleteProvider(id: string): void {
    supersedeProviderRefresh({ providerId: id, state: this.state });
    this.state.providers.delete(id);
  }

  clearProviders(): void {
    const { providers, refreshControllers } = this.state;
    for (const id of new Set([...providers.keys(), ...refreshControllers.keys()])) {
      supersedeProviderRefresh({ providerId: id, state: this.state });
    }
    providers.clear();
  }

  getProviders(): readonly providerTypesModule.Provider[] {
    return Array.from(this.state.providers.values());
  }

  getProvider(id: string): providerTypesModule.Provider | undefined {
    return this.state.providers.get(id);
  }

  getModels(provider?: string): readonly typesModuleModule2.Model<typesModuleModule2.Api>[] {
    return listModels({ provider, state: this.state });
  }

  getAllModels(provider?: string): readonly typesModuleModule2.AnyModel[] {
    return listAllModels({ provider, state: this.state });
  }

  getModelsOfType<TType extends typesModuleModule2.ModelType>(
    type: TType,
    provider?: string,
  ): readonly typesModuleModule2.ModelTypeMap[TType][] {
    return ofType(this.getAllModels(provider), type);
  }

  getModel(
    provider: string,
    id: string,
  ): typesModuleModule2.Model<typesModuleModule2.Api> | undefined {
    return this.getModels(provider).find((model) => model.id === id);
  }

  getModelOfType<TType extends typesModuleModule2.ModelType>(
    type: TType,
    provider: string,
    id: string,
  ): typesModuleModule2.ModelTypeMap[TType] | undefined {
    return this.getModelsOfType(type, provider).find((model) => model.id === id);
  }

  refresh(
    options: typesModuleModule.ModelsRefreshOptions = {},
  ): Promise<typesModuleModule.ModelsRefreshResult> {
    return Effect.runPromise(refreshModels({ options, state: this.state }));
  }

  checkAuth(
    providerId: string,
    options?: typesModule.AuthOperationOptions,
  ): Promise<typesModule.AuthCheck | undefined> {
    return checkAuth({ providerId, signal: options?.signal, state: this.state });
  }

  getAvailable(
    providerId?: string,
    options?: typesModule.AuthOperationOptions,
  ): Promise<readonly typesModuleModule2.Model<typesModuleModule2.Api>[]> {
    return getAvailable({ providerId, signal: options?.signal, state: this.state });
  }

  getAvailableOfType<TType extends typesModuleModule2.ModelType>(
    type: TType,
    providerId?: string,
    options?: typesModule.AuthOperationOptions,
  ): Promise<readonly typesModuleModule2.ModelTypeMap[TType][]> {
    return Effect.runPromise(
      Effect.promise(() => this.getAllAvailable(providerId, options)).pipe(
        Effect.map((models) => ofType(models, type)),
      ),
    );
  }

  getAllAvailable(
    providerId?: string,
    options?: typesModule.AuthOperationOptions,
  ): Promise<readonly typesModuleModule2.AnyModel[]> {
    return getAllAvailable({ providerId, signal: options?.signal, state: this.state });
  }

  getAuth(
    providerId: string,
    overrides?: resolveTypes.AuthResolutionOverrides,
  ): Promise<typesModule.AuthResult | undefined>;
  getAuth(
    model: typesModuleModule2.AnyModel,
    overrides?: resolveTypes.AuthResolutionOverrides,
  ): Promise<typesModule.AuthResult | undefined>;
  getAuth(
    providerOrModel: string | typesModuleModule2.AnyModel,
    overrides?: resolveTypes.AuthResolutionOverrides,
  ): Promise<typesModule.AuthResult | undefined> {
    return Effect.runPromise(getAuth({ overrides, providerOrModel, state: this.state }));
  }

  login(
    providerId: string,
    type: typesModule.AuthType,
    interaction: typesModule.AuthInteraction,
    options?: typesModule.LoginOptions,
  ): Promise<typesModule.Credential> {
    return Effect.runPromise(login({ interaction, options, providerId, state: this.state, type }));
  }

  logout(providerId: string, options?: typesModule.AuthOperationOptions): Promise<void> {
    return Effect.runPromise(logout({ options, providerId, state: this.state }));
  }

  stream<TApi extends typesModuleModule2.Api>(
    model: typesModuleModule2.Model<TApi>,
    context: typesModuleModule2.Context,
    options?: typesModuleModule.ModelsApiStreamOptions<TApi>,
  ): typesModuleModule2.AssistantMessageEventStream {
    return streamModel({ context, model, options, state: this.state });
  }

  complete<TApi extends typesModuleModule2.Api>(
    model: typesModuleModule2.Model<TApi>,
    context: typesModuleModule2.Context,
    options?: typesModuleModule.ModelsApiStreamOptions<TApi>,
  ): Promise<typesModuleModule2.AssistantMessage> {
    try {
      return this.stream(model, context, options).result();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  streamSimple(
    model: typesModuleModule2.Model<typesModuleModule2.Api>,
    context: typesModuleModule2.Context,
    options?: typesModuleModule.ModelsSimpleStreamOptions,
  ): typesModuleModule2.AssistantMessageEventStream {
    return streamModelSimple({ context, model, options, state: this.state });
  }

  completeSimple(
    model: typesModuleModule2.Model<typesModuleModule2.Api>,
    context: typesModuleModule2.Context,
    options?: typesModuleModule.ModelsSimpleStreamOptions,
  ): Promise<typesModuleModule2.AssistantMessage> {
    try {
      return this.streamSimple(model, context, options).result();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  streamDeferred(
    model: typesModuleModule2.Model<typesModuleModule2.Api>,
    handle: typesModuleModule2.DeferredHandle,
    options?: typesModuleModule.ModelsDeferredFetchOptions,
  ): typesModuleModule2.AssistantMessageEventStream {
    return streamDeferred({ handle, model, options, state: this.state });
  }

  fetchDeferred(
    model: typesModuleModule2.Model<typesModuleModule2.Api>,
    handle: typesModuleModule2.DeferredHandle,
    options?: typesModuleModule.ModelsDeferredFetchOptions,
  ): Promise<typesModuleModule2.AssistantMessage> {
    return this.streamDeferred(model, handle, options).result();
  }

  cancelDeferred(
    model: typesModuleModule2.Model<typesModuleModule2.Api>,
    handle: typesModuleModule2.DeferredHandle,
    options?: typesModuleModule.ModelsDeferredCancelOptions,
  ): Promise<void> {
    return cancelDeferred({ handle, model, options, state: this.state });
  }

  countTokens(
    model: typesModuleModule2.Model<typesModuleModule2.Api>,
    context: typesModuleModule2.Context,
    options?: typesModuleModule.ModelsSimpleStreamOptions,
  ): Promise<number | undefined> {
    return countModelTokens({ context, model, options, state: this.state });
  }

  generateImages(
    model: typesModuleModule2.ImageModel<typesModuleModule2.ImageApi>,
    context: typesModuleModule2.ImagesContext,
    options?: typesModuleModule.ModelsImagesOptions,
  ): Promise<typesModuleModule2.AssistantImages> {
    return generateImages({ context, model, options, state: this.state });
  }

  classify(
    model: typesModuleModule2.ClassifierModel<typesModuleModule2.ClassifierApi>,
    context: typesModuleModule2.ClassifierContext,
    options?: typesModuleModule.ModelsClassifierOptions,
  ): Promise<typesModuleModule2.ClassifierResult> {
    return classify({ context, model, options, state: this.state });
  }
}

const createModels = (
  options?: typesModuleModule.CreateModelsOptions,
): typesModuleModule.MutableModels => new ModelsImpl(options);

const modelsModule = {
  ModelsError: modelsError.ModelsError,
  calculateCost,
  clampThinkingLevel,
  createModels,
  createProvider,
  getModelType: modelOperations.getModelType,
  getSupportedThinkingLevels,
  hasApi,
  isModelType: modelOperations.isModelType,
  modelsAreEqual,
};

export default modelsModule;
