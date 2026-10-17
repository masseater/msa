import { Effect } from "effect";

import type { AuthResolutionOverrides } from "../auth/resolve.ts";
import type {
  AuthCheck,
  AuthInteraction,
  AuthOperationOptions,
  AuthResult,
  AuthType,
  Credential,
  LoginOptions,
} from "../auth/types.ts";
import type {
  AnyModel,
  Api,
  AssistantImages,
  AssistantMessage,
  AssistantMessageEventStream,
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
  ClassifierResult,
  Context,
  DeferredHandle,
  ImageApi,
  ImageModel,
  ImagesContext,
  Model,
  ModelType,
  ModelTypeMap,
} from "../types.ts";
import * as Ops from "./operations.ts";
import type { Provider } from "./provider-types.ts";
import { createModelsState, type ModelsState } from "./state.ts";
import type {
  CreateModelsOptions,
  ModelsApiStreamOptions,
  ModelsClassifierOptions,
  ModelsDeferredCancelOptions,
  ModelsDeferredFetchOptions,
  ModelsImagesOptions,
  ModelsRefreshOptions,
  ModelsRefreshResult,
  ModelsSimpleStreamOptions,
  MutableModels,
} from "./types.ts";

class ModelsImpl implements MutableModels {
  private readonly state: ModelsState;

  constructor(options?: CreateModelsOptions) {
    this.state = createModelsState(options);
  }

  setProvider(provider: Provider): void {
    Ops.supersedeProviderRefresh({ state: this.state, providerId: provider.id });
    this.state.providers.set(provider.id, provider);
  }

  deleteProvider(id: string): void {
    Ops.supersedeProviderRefresh({ state: this.state, providerId: id });
    this.state.providers.delete(id);
  }

  clearProviders(): void {
    const { providers, refreshControllers } = this.state;
    for (const id of new Set([...providers.keys(), ...refreshControllers.keys()])) {
      Ops.supersedeProviderRefresh({ state: this.state, providerId: id });
    }
    providers.clear();
  }

  getProviders(): readonly Provider[] {
    return Array.from(this.state.providers.values());
  }

  getProvider(id: string): Provider | undefined {
    return this.state.providers.get(id);
  }

  getModels(provider?: string): readonly Model<Api>[] {
    return Ops.listModels({ state: this.state, provider });
  }

  getAllModels(provider?: string): readonly AnyModel[] {
    return Ops.listAllModels({ state: this.state, provider });
  }

  getModelsOfType<TType extends ModelType>(
    type: TType,
    provider?: string,
  ): readonly ModelTypeMap[TType][] {
    return Ops.ofType(this.getAllModels(provider), type);
  }

  getModel(provider: string, id: string): Model<Api> | undefined {
    return this.getModels(provider).find((model) => model.id === id);
  }

  getModelOfType<TType extends ModelType>(
    type: TType,
    provider: string,
    id: string,
  ): ModelTypeMap[TType] | undefined {
    return this.getModelsOfType(type, provider).find((model) => model.id === id);
  }

  refresh(options: ModelsRefreshOptions = {}): Promise<ModelsRefreshResult> {
    return Effect.runPromise(Ops.refreshModels({ state: this.state, options }));
  }

  checkAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthCheck | undefined> {
    return Ops.checkAuth({ state: this.state, providerId, signal: options?.signal });
  }

  getAvailable(
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly Model<Api>[]> {
    return Ops.getAvailable({ state: this.state, providerId, signal: options?.signal });
  }

  getAvailableOfType<TType extends ModelType>(
    type: TType,
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly ModelTypeMap[TType][]> {
    return Effect.runPromise(
      Effect.promise(() => this.getAllAvailable(providerId, options)).pipe(
        Effect.map((models) => Ops.ofType(models, type)),
      ),
    );
  }

  getAllAvailable(
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly AnyModel[]> {
    return Ops.getAllAvailable({ state: this.state, providerId, signal: options?.signal });
  }

  getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
  getAuth(model: AnyModel, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
  getAuth(
    providerOrModel: string | AnyModel,
    overrides?: AuthResolutionOverrides,
  ): Promise<AuthResult | undefined> {
    return Effect.runPromise(Ops.getAuth({ state: this.state, providerOrModel, overrides }));
  }

  login(
    providerId: string,
    type: AuthType,
    interaction: AuthInteraction,
    options?: LoginOptions,
  ): Promise<Credential> {
    return Effect.runPromise(
      Ops.login({ state: this.state, providerId, type, interaction, options }),
    );
  }

  logout(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return Effect.runPromise(Ops.logout({ state: this.state, providerId, options }));
  }

  stream<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): AssistantMessageEventStream {
    return Ops.streamModel({ state: this.state, model, context, options });
  }

  complete<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): Promise<AssistantMessage> {
    try {
      return this.stream(model, context, options).result();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  streamSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): AssistantMessageEventStream {
    return Ops.streamModelSimple({ state: this.state, model, context, options });
  }

  completeSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): Promise<AssistantMessage> {
    try {
      return this.streamSimple(model, context, options).result();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  streamDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredFetchOptions,
  ): AssistantMessageEventStream {
    return Ops.streamDeferred({ state: this.state, model, handle, options });
  }

  fetchDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredFetchOptions,
  ): Promise<AssistantMessage> {
    return this.streamDeferred(model, handle, options).result();
  }

  cancelDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredCancelOptions,
  ): Promise<void> {
    return Ops.cancelDeferred({ state: this.state, model, handle, options });
  }

  generateImages(
    model: ImageModel<ImageApi>,
    context: ImagesContext,
    options?: ModelsImagesOptions,
  ): Promise<AssistantImages> {
    return Ops.generateImages({ state: this.state, model, context, options });
  }

  classify(
    model: ClassifierModel<ClassifierApi>,
    context: ClassifierContext,
    options?: ModelsClassifierOptions,
  ): Promise<ClassifierResult> {
    return Ops.classify({ state: this.state, model, context, options });
  }
}

export const createModels = (options?: CreateModelsOptions): MutableModels =>
  new ModelsImpl(options);
