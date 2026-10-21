import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import runtimeComponents from "./model-runtime/runtime-components.ts";
import runtimeParts from "./model-runtime/runtime-parts.ts";
import runtimeRefresh from "./model-runtime/runtime-refresh.ts";
import virtualModelsModule from "./virtual-models.ts";

const { isVirtualModel } = virtualModelsModule;
const { awaited, awaiting } = awaitingModule;
const { createRuntimeComponents } = runtimeComponents;
const { loadRuntimeParts } = runtimeParts;
const { refreshRuntime, refreshSignal } = runtimeRefresh;

type Model = aiTypes.Model<aiTypes.Api>;
type Options = aiTypes.AuthOperationOptions;
type Parts = Awaited<ReturnType<typeof loadRuntimeParts>>;

export default class ModelRuntime implements aiTypes.Models {
  private readonly parts: Parts;
  private readonly runtime: ReturnType<typeof createRuntimeComponents>;

  private constructor(parts: Parts) {
    this.parts = parts;
    this.runtime = createRuntimeComponents(parts, {
      getAuth: (model, overrides) => this.getAuth(model, overrides),
      refresh: () => void this.refresh({ allowNetwork: false }),
      resolveModel: (model, messages, options) => this.resolveModel(model, messages, options),
      streamSimple: (model, context, options) => this.streamSimple(model, context, options),
    });
    this.runtime.catalog.rebuild();
    this.runtime.availability.updateModels();
  }

  static create(options: modelRuntimeTypes.CreateModelRuntimeOptions = {}): Promise<ModelRuntime> {
    return Effect.runPromise(
      awaiting(function* () {
        const runtime = new ModelRuntime(yield* awaited(loadRuntimeParts(options)));
        if (options.refreshOnCreate === false) return runtime;
        const allowNetwork =
          runtime.parts.modelNetworkEnabled && options.allowModelNetwork === true;
        const { cancel, signal } = refreshSignal(options, allowNetwork);
        try {
          yield* awaited(
            runtime.refresh({ allowNetwork, ...(signal === undefined ? {} : { signal }) }),
          );
        } finally {
          cancel?.();
        }
        return runtime;
      }),
    );
  }

  getModelPolicy(): modelRuntimeTypes.ModelPolicy {
    return this.runtime.catalog.modelPolicy;
  }

  setModelPolicy(policy: modelRuntimeTypes.ModelPolicy): void {
    if (this.runtime.catalog.setModelPolicy(policy)) this.runtime.availability.updateModels();
  }

  getCatalogModels(providerId?: string): readonly Model[] {
    return this.runtime.catalog.catalogModels(providerId);
  }

  getProviders(): readonly aiTypes.Provider[] {
    return this.runtime.models.getProviders();
  }

  getProvider(providerId: string): aiTypes.Provider | undefined {
    return this.runtime.models.getProvider(providerId);
  }

  getModels(providerId?: string): readonly Model[] {
    return this.runtime.models.getModels(providerId);
  }

  getModel(providerId: string, modelId: string): Model | undefined {
    return this.runtime.models.getModel(providerId, modelId);
  }

  getModelsOfType<T extends aiTypes.ModelType>(type: T, providerId?: string) {
    return this.runtime.models.getModelsOfType(type, providerId);
  }

  getModelOfType<T extends aiTypes.ModelType>(type: T, providerId: string, modelId: string) {
    return this.runtime.models.getModelOfType(type, providerId, modelId);
  }

  getAllModels(providerId?: string): readonly aiTypes.AnyModel[] {
    return this.runtime.models.getAllModels(providerId);
  }

  getAvailableOfType<T extends aiTypes.ModelType>(type: T, providerId?: string, options?: Options) {
    return this.runtime.models.getAvailableOfType(type, providerId, options);
  }

  getAllAvailable(providerId?: string, options?: Options): Promise<readonly aiTypes.AnyModel[]> {
    return this.runtime.models.getAllAvailable(providerId, options);
  }

  checkAuth(providerId: string, options?: Options): Promise<aiTypes.AuthCheck | undefined> {
    return this.runtime.models.checkAuth(providerId, options);
  }

  getAvailable(providerId?: string, options?: Options): Promise<readonly Model[]> {
    return this.runtime.availability.getAvailable(providerId, options);
  }

  getAvailableSnapshot(): readonly Model[] {
    return this.runtime.availability.available;
  }

  getError(): string | undefined {
    const errors = [...this.runtime.catalog.errors(), ...this.runtime.availability.errors()];
    return errors.length > 0 ? errors.join("\n\n") : undefined;
  }

  getRegisteredProviderConfig(providerId: string) {
    return this.runtime.catalog.extensionConfig(providerId);
  }

  getRegisteredProviderIds(): readonly string[] {
    return this.runtime.catalog.registeredIds();
  }

  getRegisteredNativeProvider(providerId: string): aiTypes.Provider | undefined {
    return this.runtime.catalog.nativeProvider(providerId);
  }

  getCompatibilityRequestConfig(model: Model): modelRuntimeTypes.CompatibilityRequestConfig {
    return this.runtime.auth.compatibilityConfig(model);
  }

  isUsingOAuth(providerId: string): boolean {
    return this.runtime.availability.authCheck(providerId)?.type === "oauth";
  }

  isUsingSubscription(providerId: string): boolean {
    const oauth = this.runtime.models.getProvider(providerId)?.auth.oauth;
    return this.isUsingOAuth(providerId) && oauth?.isSubscription === true;
  }

  hasConfiguredAuth(providerId: string): boolean {
    return this.runtime.availability.hasConfiguredAuth(providerId);
  }

  getAuth(
    providerOrModel: string | aiTypes.AnyModel,
    overrides: modelRuntimeTypes.ModelRuntimeAuthOverrides = {},
  ): Promise<aiTypes.AuthResult | undefined> {
    return this.runtime.auth.getAuth(providerOrModel, overrides);
  }

  setRuntimeApiKey(providerId: string, apiKey: string, options: Options = {}): Promise<void> {
    return this.runtime.credentialOperations.setRuntimeApiKey(providerId, apiKey, options);
  }

  removeRuntimeApiKey(providerId: string, options: Options = {}): Promise<void> {
    return this.runtime.credentialOperations.removeRuntimeApiKey(providerId, options);
  }

  listCredentials(options?: Options): Promise<readonly aiTypes.CredentialInfo[]> {
    return this.runtime.credentials.list(options);
  }

  getProviderAuthStatus(providerId: string): modelRuntimeTypes.ProviderAuthStatus {
    return this.runtime.auth.status(providerId);
  }

  stream<TApi extends aiTypes.Api>(
    model: aiTypes.Model<TApi>,
    context: aiTypes.Context,
    options?: aiTypes.ModelsApiStreamOptions<TApi>,
  ): aiTypes.AssistantMessageEventStream {
    return this.runtime.requests.stream(model, context, options);
  }

  complete<TApi extends aiTypes.Api>(
    model: aiTypes.Model<TApi>,
    context: aiTypes.Context,
    options?: aiTypes.ModelsApiStreamOptions<TApi>,
  ): Promise<aiTypes.AssistantMessage> {
    return this.stream(model, context, options).result();
  }

  streamSimple(
    model: Model,
    context: aiTypes.Context,
    options?: aiTypes.ModelsSimpleStreamOptions,
  ) {
    return this.runtime.requests.streamSimple(model, context, options);
  }

  completeSimple(
    model: Model,
    context: aiTypes.Context,
    options?: aiTypes.ModelsSimpleStreamOptions,
  ) {
    return this.streamSimple(model, context, options).result();
  }

  streamDeferred(
    model: Model,
    handle: aiTypes.DeferredHandle,
    options?: aiTypes.ModelsDeferredFetchOptions,
  ): aiTypes.AssistantMessageEventStream {
    return this.runtime.requests.streamDeferred(model, handle, options);
  }

  fetchDeferred(
    model: Model,
    handle: aiTypes.DeferredHandle,
    options?: aiTypes.ModelsDeferredFetchOptions,
  ): Promise<aiTypes.AssistantMessage> {
    return this.streamDeferred(model, handle, options).result();
  }

  cancelDeferred(
    model: Model,
    handle: aiTypes.DeferredHandle,
    options?: aiTypes.ModelsDeferredCancelOptions,
  ): Promise<void> {
    return this.runtime.requests.cancelDeferred(model, handle, options);
  }

  countTokens(model: Model, context: aiTypes.Context, options?: aiTypes.ModelsSimpleStreamOptions) {
    return this.runtime.requests.countTokens(model, context, options);
  }

  generateImages(
    model: aiTypes.ImageModel<aiTypes.ImageApi>,
    context: aiTypes.ImagesContext,
    options?: aiTypes.ModelsImagesOptions,
  ): Promise<aiTypes.AssistantImages> {
    return this.runtime.requests.generateImages(model, context, options);
  }

  classify(
    model: aiTypes.ClassifierModel<aiTypes.ClassifierApi>,
    context: aiTypes.ClassifierContext,
    options?: aiTypes.ModelsClassifierOptions,
  ): Promise<aiTypes.ClassifierResult> {
    return this.runtime.requests.classify(model, context, options);
  }

  login(
    providerId: string,
    type: aiTypes.AuthType,
    interaction: aiTypes.AuthInteraction,
    options?: aiTypes.LoginOptions,
  ): Promise<aiTypes.Credential> {
    return this.runtime.credentialOperations.login(providerId, type, interaction, options);
  }

  logout(providerId: string, options: Options = {}): Promise<void> {
    return this.runtime.credentialOperations.logout(providerId, options);
  }

  refresh(options: aiTypes.ModelsRefreshOptions = {}): Promise<aiTypes.ModelsRefreshResult> {
    return refreshRuntime({ ...this.runtime, ...this.parts }, options);
  }

  registerNativeProvider(provider: aiTypes.Provider): void {
    this.runtime.registrations.registerNative(provider);
  }

  registerProvider(providerId: string, config: modelRuntimeTypes.ProviderConfigInput): void {
    this.runtime.registrations.registerExtension(providerId, config);
  }

  unregisterProvider(providerId: string): void {
    this.runtime.registrations.unregister(providerId);
  }

  registerVirtualModel(definition: modelRuntimeTypes.VirtualModelDefinition): void {
    this.runtime.registrations.registerVirtual(definition);
  }

  unregisterVirtualModel(providerId: string, id: string): void {
    this.runtime.registrations.unregisterVirtual(providerId, id);
  }

  resolveModel(
    model: Model,
    messages: readonly aiTypes.Message[],
    options: modelRuntimeTypes.ModelRouteOptions,
  ): Promise<modelRuntimeTypes.ModelRoute> {
    return this.runtime.virtualModels.route(model, messages, options, this);
  }

  getPhysicalModel(providerId: string, modelId: string): Model | undefined {
    const model = this.runtime.models.getModel(providerId, modelId);
    return model !== undefined && !isVirtualModel(model) ? model : undefined;
  }
}
