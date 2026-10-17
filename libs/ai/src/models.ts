import { lazyStream } from "./api/lazy.ts";
import { defaultProviderAuthContext as defaultAuthContext } from "./auth/context.ts";
import { InMemoryCredentialStore } from "./auth/credential-store.ts";
import {
  type AuthResolutionOverrides,
  ModelsError,
  refreshStoredOAuthCredential,
  resolveProviderAuth,
} from "./auth/resolve.ts";
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
  ProviderAuth,
} from "./auth/types.ts";
import { InMemoryModelsStore, type ModelsStore, type ModelsStoreEntry } from "./models-store.ts";
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
  ModelCostRates,
  ModelThinkingLevel,
  ModelType,
  ModelTypeMap,
  ProviderClassifier,
  ProviderHeaders,
  ProviderImages,
  ProviderRequestOptions,
  ProviderStreams,
  SimpleStreamOptions,
  TranscriptContext,
  Usage,
} from "./types.ts";
import { operationSignal, raceWithAbortSignal } from "./utils/abort.ts";
import {
  assertChatModel,
  assertClassifierInputSupported,
  assertClassifierModel,
  assertImageModel,
  classifierErrorResult,
  getModelType,
  imageErrorResult,
  isModelType,
} from "./utils/model-operations.ts";
import { normalizeContext } from "./utils/transcript.ts";

export { ModelsError, type ModelsErrorCode } from "./auth/resolve.ts";
export { getModelType, isModelType } from "./utils/model-operations.ts";

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

const KNOWN_MODEL_TYPES: Record<ModelType, true> = { chat: true, image: true, classifier: true };

function hasKnownModelType(model: AnyModel): boolean {
  return Object.hasOwn(KNOWN_MODEL_TYPES, getModelType(model));
}

function withKnownModelTypes(entry: ModelsStoreEntry): ModelsStoreEntry {
  return { ...entry, models: entry.models.filter(hasKnownModelType) };
}

type ProviderModel<TApi extends Api> =
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

function mergeHeaders(
  base: ProviderHeaders | undefined,
  override: ProviderHeaders | undefined,
): ProviderHeaders | undefined {
  if (base === undefined && override === undefined) return undefined;
  const merged = { ...base };
  for (const [name, value] of Object.entries(override ?? {})) {
    const lowerName = name.toLowerCase();
    for (const existingName of Object.keys(merged)) {
      if (existingName.toLowerCase() === lowerName) delete merged[existingName];
    }
    merged[name] = value;
  }
  return merged;
}

class ModelsImpl implements MutableModels {
  private providers = new Map<string, Provider>();
  private credentials: CredentialStore;
  private modelsStore: ModelsStore;
  private authContext: AuthContext;
  private refreshGenerations = new Map<string, number>();
  private refreshControllers = new Map<string, AbortController>();
  private publicationChains = new Map<string, Promise<unknown>>();

  constructor(options?: CreateModelsOptions) {
    this.credentials = options?.credentials ?? new InMemoryCredentialStore();
    this.modelsStore = options?.modelsStore ?? new InMemoryModelsStore();
    this.authContext = options?.authContext ?? defaultAuthContext();
  }

  setProvider(provider: Provider): void {
    this.supersedeProviderRefresh(provider.id);
    this.providers.set(provider.id, provider);
  }

  deleteProvider(id: string): void {
    this.supersedeProviderRefresh(id);
    this.providers.delete(id);
  }

  clearProviders(): void {
    for (const id of new Set([...this.providers.keys(), ...this.refreshControllers.keys()])) {
      this.supersedeProviderRefresh(id);
    }
    this.providers.clear();
  }

  getProviders(): readonly Provider[] {
    return Array.from(this.providers.values());
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  getModels(provider?: string): readonly Model<Api>[] {
    if (provider !== undefined) {
      const entry = this.providers.get(provider);
      if (entry === undefined) return [];
      try {
        return entry.getModels();
      } catch {
        return [];
      }
    }

    const models: Model<Api>[] = [];
    for (const entry of this.providers.values()) {
      try {
        models.push(...entry.getModels());
      } catch {}
    }
    return models;
  }

  getAllModels(provider?: string): readonly AnyModel[] {
    if (provider !== undefined) {
      const entry = this.providers.get(provider);
      if (entry === undefined) return [];
      try {
        return entry.getAllModels?.() ?? entry.getModels();
      } catch {
        return [];
      }
    }

    const models: AnyModel[] = [];
    for (const entry of this.providers.values()) {
      try {
        models.push(...(entry.getAllModels?.() ?? entry.getModels()));
      } catch {}
    }
    return models;
  }

  getModelsOfType<TType extends ModelType>(
    type: TType,
    provider?: string,
  ): readonly ModelTypeMap[TType][] {
    return this.getAllModels(provider).filter((model): model is ModelTypeMap[TType] =>
      isModelType(model, type),
    );
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

  private supersedeProviderRefresh(providerId: string): number {
    const generation = (this.refreshGenerations.get(providerId) ?? 0) + 1;
    this.refreshGenerations.set(providerId, generation);
    const previous = this.refreshControllers.get(providerId);
    if (previous !== undefined) {
      this.refreshControllers.delete(providerId);
      previous.abort();
    }
    return generation;
  }

  private beginProviderRefresh(providerId: string): {
    generation: number;
    controller: AbortController;
  } {
    const generation = this.supersedeProviderRefresh(providerId);
    const controller = new AbortController();
    this.refreshControllers.set(providerId, controller);
    return { generation, controller };
  }

  private publishProviderModels(
    providerId: string,
    generation: number,
    signal: AbortSignal,
    publication: ModelsPublication,
  ): Promise<boolean> {
    const previous = this.publicationChains.get(providerId) ?? Promise.resolve();
    const queued = (async () => {
      await previous.catch(() => {});
      if (signal.aborted || this.refreshGenerations.get(providerId) !== generation) return false;

      if (publication.persist === null) {
        await this.modelsStore.delete(providerId, { signal });
      } else if (publication.persist !== undefined) {
        await this.modelsStore.write(providerId, structuredClone(publication.persist), { signal });
      }

      if (signal.aborted || this.refreshGenerations.get(providerId) !== generation) return false;
      publication.update?.();
      return true;
    })();
    const tail = queued.catch(() => {});
    this.publicationChains.set(providerId, tail);
    void tail.then(() => {
      if (this.publicationChains.get(providerId) === tail)
        this.publicationChains.delete(providerId);
    });
    return raceWithAbortSignal(queued, signal);
  }

  private async runProviderRefreshPhase(
    provider: Provider & Required<Pick<Provider, "refreshModels">>,
    credential: Credential | undefined,
    allowNetwork: boolean,
    force: boolean | undefined,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    const stored = await this.modelsStore.read(provider.id, { signal });
    await provider.refreshModels({
      credential,
      stored: stored === undefined ? undefined : withKnownModelTypes(structuredClone(stored)),
      publish: (publication) =>
        this.publishProviderModels(provider.id, generation, signal, publication),
      allowNetwork,
      force: allowNetwork ? force : undefined,
      signal,
      baseUrl: provider.baseUrl,
    });
  }

  async refresh(options: ModelsRefreshOptions = {}): Promise<ModelsRefreshResult> {
    const allowNetwork = options.allowNetwork ?? true;
    const callerSignal = operationSignal(options.signal);
    const errors = new Map<string, Error>();
    if (callerSignal.aborted) return { aborted: true, errors };
    const selected = options.providers === undefined ? undefined : new Set(options.providers);
    const refreshable = Array.from(this.providers.values()).filter(
      (provider): provider is Provider & Required<Pick<Provider, "refreshModels">> =>
        provider.refreshModels !== undefined &&
        (selected === undefined || selected.has(provider.id)),
    );

    const refresh = Promise.all(
      refreshable.map(async (provider) => {
        const { generation, controller } = this.beginProviderRefresh(provider.id);
        const signal = AbortSignal.any([callerSignal, controller.signal]);
        const operation = (async () => {
          let storedCredential: Credential | undefined;
          let credentialError: unknown;
          try {
            storedCredential = await this.readCredential(provider.id, signal);
          } catch (error) {
            credentialError = error;
          }

          await this.runProviderRefreshPhase(
            provider,
            storedCredential,
            false,
            undefined,
            generation,
            signal,
          );
          if (credentialError !== undefined) throw credentialError;
          if (!allowNetwork || signal.aborted) return;

          const credential = await this.resolveRefreshCredential(
            provider,
            storedCredential,
            signal,
          );
          if (credential === undefined) return;
          await this.runProviderRefreshPhase(
            provider,
            credential,
            true,
            options.force,
            generation,
            signal,
          );
        })();

        try {
          await raceWithAbortSignal(operation, signal);
        } catch (error) {
          if (!signal.aborted) {
            errors.set(
              provider.id,
              error instanceof Error
                ? error
                : new ModelsError("model_source", `Model refresh failed for ${provider.id}`, {
                    cause: error,
                  }),
            );
          }
        } finally {
          if (this.refreshControllers.get(provider.id) === controller) {
            this.refreshControllers.delete(provider.id);
          }
        }
      }),
    );

    try {
      await raceWithAbortSignal(refresh, callerSignal);
    } catch (error) {
      if (!callerSignal.aborted) throw error;
    }

    return { aborted: callerSignal.aborted, errors: new Map(errors) };
  }

  private async resolveRefreshCredential(
    provider: Provider,
    stored: Credential | undefined,
    signal: AbortSignal,
  ): Promise<Credential | undefined> {
    if (stored?.type === "oauth") {
      const oauth = provider.auth.oauth;
      if (oauth === undefined) return undefined;
      if (Date.now() < stored.expires) return stored;
      if (signal.aborted) return undefined;
      return refreshStoredOAuthCredential(
        this.credentials,
        provider.id,
        oauth,
        (current) => Date.now() >= current.expires,
        signal,
      );
    }

    const apiKey = provider.auth.apiKey;
    if (apiKey === undefined) return undefined;
    const credential = stored?.type === "api_key" ? stored : undefined;
    const result = await apiKey.resolve({ ctx: this.authContext, credential, signal });
    if (result === undefined) return undefined;
    return { type: "api_key", key: result.auth.apiKey, env: result.env };
  }

  private async readCredential(
    providerId: string,
    signal: AbortSignal,
  ): Promise<Credential | undefined> {
    try {
      return await this.credentials.read(providerId, { signal });
    } catch (error) {
      throw new ModelsError("auth", `Credential store read failed for ${providerId}`, {
        cause: error,
      });
    }
  }

  private async checkProviderAuth(
    provider: Provider,
    credential: Credential | undefined,
    signal: AbortSignal,
  ): Promise<AuthCheck | undefined> {
    if (credential?.type === "oauth") {
      return provider.auth.oauth === undefined ? undefined : { source: "OAuth", type: "oauth" };
    }
    const apiKey = provider.auth.apiKey;
    if (apiKey === undefined) return undefined;
    if (apiKey.check !== undefined) {
      try {
        return await apiKey.check({
          ctx: this.authContext,
          credential: credential?.type === "api_key" ? credential : undefined,
          signal,
        });
      } catch (error) {
        throw new ModelsError("auth", `API key auth check failed for provider ${provider.id}`, {
          cause: error,
        });
      }
    }

    const resolution = await resolveProviderAuth(provider, this.credentials, this.authContext, {
      signal,
    });
    return resolution === undefined ? undefined : { source: resolution.source, type: "api_key" };
  }

  checkAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthCheck | undefined> {
    const signal = operationSignal(options?.signal);
    const check = (async () => {
      signal.throwIfAborted();
      const provider = this.providers.get(providerId);
      if (provider === undefined) return undefined;
      return this.checkProviderAuth(
        provider,
        await this.readCredential(providerId, signal),
        signal,
      );
    })();
    return raceWithAbortSignal(check, signal);
  }

  private async getAuthenticatedProviders(providerId: string | undefined, signal: AbortSignal) {
    signal.throwIfAborted();
    const providers =
      providerId !== undefined && providerId !== ""
        ? [this.providers.get(providerId)].filter((entry) => entry !== undefined)
        : this.getProviders();
    const checks = await Promise.all(
      providers.map(async (provider) => {
        const credential = await this.readCredential(provider.id, signal);
        return {
          provider,
          credential,
          auth: await this.checkProviderAuth(provider, credential, signal),
        };
      }),
    );
    return checks.filter((entry) => entry.auth !== undefined);
  }

  getAvailable(
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly Model<Api>[]> {
    const signal = operationSignal(options?.signal);
    const available = (async () => {
      const providers = await this.getAuthenticatedProviders(providerId, signal);
      return providers.flatMap(({ provider, credential }) => {
        const models = provider.getModels();
        return provider.filterModels?.(models, credential) ?? models;
      });
    })();
    return raceWithAbortSignal(available, signal);
  }

  async getAvailableOfType<TType extends ModelType>(
    type: TType,
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly ModelTypeMap[TType][]> {
    return (await this.getAllAvailable(providerId, options)).filter(
      (model): model is ModelTypeMap[TType] => isModelType(model, type),
    );
  }

  getAllAvailable(
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly AnyModel[]> {
    const signal = operationSignal(options?.signal);
    const available = (async () => {
      const providers = await this.getAuthenticatedProviders(providerId, signal);
      return providers.flatMap(({ provider, credential }) => {
        const models = provider.getAllModels?.() ?? provider.getModels();
        if (provider.filterAllModels !== undefined)
          return provider.filterAllModels(models, credential);
        if (provider.filterModels === undefined) return models;
        const availableChatIds = new Set(
          provider.filterModels(provider.getModels(), credential).map((model) => model.id),
        );
        return models.filter(
          (model) => !isModelType(model, "chat") || availableChatIds.has(model.id),
        );
      });
    })();
    return raceWithAbortSignal(available, signal);
  }

  getAuth(providerId: string, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
  getAuth(model: AnyModel, overrides?: AuthResolutionOverrides): Promise<AuthResult | undefined>;
  async getAuth(
    providerOrModel: string | AnyModel,
    overrides?: AuthResolutionOverrides,
  ): Promise<AuthResult | undefined> {
    const signal = operationSignal(overrides?.signal);
    const providerId =
      typeof providerOrModel === "string" ? providerOrModel : providerOrModel.provider;
    const provider = this.providers.get(providerId);
    if (provider === undefined) return undefined;
    const result = await resolveProviderAuth(provider, this.credentials, this.authContext, {
      ...overrides,
      signal,
    });
    if (
      result === undefined ||
      typeof providerOrModel === "string" ||
      providerOrModel.headers === undefined
    )
      return result;
    return {
      ...result,
      auth: {
        ...result.auth,
        headers: mergeHeaders(result.auth.headers, providerOrModel.headers),
      },
    };
  }

  async login(
    providerId: string,
    type: AuthType,
    interaction: AuthInteraction,
    options?: LoginOptions,
  ): Promise<Credential> {
    const signal = operationSignal(interaction.signal);
    signal.throwIfAborted();
    const provider = this.providers.get(providerId);
    if (provider === undefined)
      throw new ModelsError("provider", `Unknown provider: ${providerId}`);
    const method = type === "oauth" ? provider.auth.oauth : provider.auth.apiKey;
    if (method?.login === undefined) {
      throw new ModelsError("auth", `${provider.name} does not support ${type} login`);
    }
    const loginOperation: Promise<Credential> = method.login({ ...interaction, signal }, options);
    const credential = await raceWithAbortSignal(loginOperation, signal);
    let mutationStarted = false;
    let markMutationStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markMutationStarted = resolve;
    });
    const mutation = this.credentials.modify(
      providerId,
      () => {
        mutationStarted = true;
        markMutationStarted?.();
        return Promise.resolve(credential);
      },
      { signal },
    );
    void mutation.catch(() => {});
    try {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          if (!mutationStarted) reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        void Promise.race([started, mutation]).then(
          () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          },
          (error: unknown) => {
            signal.removeEventListener("abort", onAbort);
            reject(error);
          },
        );
        if (signal.aborted) onAbort();
      });
      await mutation;
    } catch (error) {
      signal.throwIfAborted();
      throw new ModelsError("auth", `Credential store modify failed for ${providerId}`, {
        cause: error,
      });
    }
    return credential;
  }

  async logout(providerId: string, options?: AuthOperationOptions): Promise<void> {
    const signal = operationSignal(options?.signal);
    signal.throwIfAborted();
    try {
      await this.credentials.delete(providerId, { signal });
    } catch (error) {
      signal.throwIfAborted();
      throw new ModelsError("auth", `Credential store delete failed for ${providerId}`, {
        cause: error,
      });
    }
  }

  private requireProvider(model: AnyModel): Provider {
    const provider = this.providers.get(model.provider);
    if (provider === undefined) {
      throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
    }
    return provider;
  }

  private requireChatProvider(model: Model<Api>): Provider {
    assertChatModel(model);
    return this.requireProvider(model);
  }

  private async applyAuth<
    TModel extends AnyModel,
    TOptions extends ProviderRequestOptions<TModel> & ModelsRequestTransforms,
  >(
    model: TModel,
    options: TOptions | undefined,
  ): Promise<{
    requestModel: TModel;
    requestOptions: Omit<TOptions, "transformHeaders"> & ProviderRequestOptions<TModel>;
  }> {
    this.requireProvider(model);
    const resolution = await this.getAuth(model, {
      apiKey: options?.apiKey,
      env: options?.env,
      signal: options?.signal,
    });
    if (resolution === undefined) {
      throw new ModelsError("auth", `Provider is not configured: ${model.provider}`);
    }
    const auth = resolution.auth;

    const apiKey = options?.apiKey ?? auth.apiKey;
    let headers = mergeHeaders(auth.headers, options?.headers);
    if (options?.transformHeaders !== undefined)
      headers = await options.transformHeaders(headers ?? {});
    const env =
      resolution.env !== undefined || options?.env !== undefined
        ? { ...(resolution.env ?? {}), ...(options?.env ?? {}) }
        : undefined;
    const requestModel: TModel =
      auth.baseUrl !== undefined && auth.baseUrl !== ""
        ? { ...model, baseUrl: auth.baseUrl }
        : model;
    const { transformHeaders: _transformHeaders, ...providerOptions } = options ?? {};
    const requestOptions = { ...providerOptions, apiKey, headers, env } as Omit<
      TOptions,
      "transformHeaders"
    > &
      ProviderRequestOptions<TModel>;

    return { requestModel, requestOptions };
  }

  stream<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): AssistantMessageEventStream {
    const transcript = normalizeContext(context);
    return lazyStream(model, async () => {
      const provider = this.requireChatProvider(model);
      const { requestModel, requestOptions } = await this.applyAuth(
        model,
        options as ModelsApiStreamOptions<Api> | undefined,
      );
      return provider.stream(requestModel, transcript, requestOptions as ApiStreamOptions<TApi>);
    });
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
    const transcript = normalizeContext(context);
    return lazyStream(model, async () => {
      const provider = this.requireChatProvider(model);
      const { requestModel, requestOptions } = await this.applyAuth(model, options);
      return provider.streamSimple(requestModel, transcript, requestOptions as SimpleStreamOptions);
    });
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
    return lazyStream(model, async () => {
      const provider = this.requireChatProvider(model);
      if (provider.fetchDeferred === undefined) {
        throw new ModelsError(
          "provider",
          `Provider ${model.provider} does not support deferred responses`,
        );
      }
      const { requestModel, requestOptions } = await this.applyAuth(model, options);
      return provider.fetchDeferred(requestModel, handle, requestOptions as DeferredFetchOptions);
    });
  }

  fetchDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredFetchOptions,
  ): Promise<AssistantMessage> {
    return this.streamDeferred(model, handle, options).result();
  }

  async cancelDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredCancelOptions,
  ): Promise<void> {
    const provider = this.requireChatProvider(model);
    if (provider.cancelDeferred === undefined) {
      throw new ModelsError(
        "provider",
        `Provider ${model.provider} does not support deferred responses`,
      );
    }
    const { requestModel, requestOptions } = await this.applyAuth(model, options);
    await provider.cancelDeferred(requestModel, handle, requestOptions);
  }

  async generateImages(
    model: ImageModel<ImageApi>,
    context: ImagesContext,
    options?: ModelsImagesOptions,
  ): Promise<AssistantImages> {
    try {
      assertImageModel(model);
      const provider = this.requireProvider(model);
      if (provider.generateImages === undefined) {
        throw new ModelsError(
          "provider",
          `Provider ${model.provider} does not support image generation`,
        );
      }
      const { requestModel, requestOptions } = await this.applyAuth(model, options);
      return await provider.generateImages(requestModel, context, requestOptions);
    } catch (error) {
      return imageErrorResult(model, error, options?.signal?.aborted);
    }
  }

  async classify(
    model: ClassifierModel<ClassifierApi>,
    context: ClassifierContext,
    options?: ModelsClassifierOptions,
  ): Promise<ClassifierResult> {
    try {
      assertClassifierModel(model);
      assertClassifierInputSupported(model, context);
      const provider = this.requireProvider(model);
      if (provider.classify === undefined) {
        throw new ModelsError(
          "provider",
          `Provider ${model.provider} does not support classification`,
        );
      }
      const { requestModel, requestOptions } = await this.applyAuth(model, options);
      return await provider.classify(requestModel, context, requestOptions);
    } catch (error) {
      return classifierErrorResult(model, error, options?.signal?.aborted);
    }
  }
}

export function createModels(options?: CreateModelsOptions): MutableModels {
  return new ModelsImpl(options);
}

export interface CreateProviderOptions<TApi extends Api = Api> {
  id: string;
  name?: string | undefined;
  baseUrl?: string | undefined;
  headers?: ProviderHeaders | undefined;
  auth: ProviderAuth;
  models: readonly ProviderModel<TApi>[];
  fetchModels?:
    | ((context: RefreshModelsContext) => Promise<readonly ProviderModel<TApi>[]>)
    | undefined;
  filterModels?: (
    models: readonly Model<TApi>[],
    credential: Credential | undefined,
  ) => readonly Model<TApi>[];
  filterAllModels?: (
    models: readonly ProviderModel<TApi>[],
    credential: Credential | undefined,
  ) => readonly ProviderModel<TApi>[];
  api?: ProviderStreams | Partial<Record<TApi, ProviderStreams>> | undefined;
  images?: Partial<Record<ImageApi, ProviderImages>> | undefined;
  classifiers?: Partial<Record<ClassifierApi, ProviderClassifier>> | undefined;
}

export function createProvider<TApi extends Api = Api>(
  input: CreateProviderOptions<TApi>,
): Provider<TApi> {
  const single =
    input.api !== undefined && typeof (input.api as ProviderStreams).stream === "function"
      ? (input.api as ProviderStreams)
      : undefined;
  const byApi =
    single !== undefined || input.api === undefined
      ? undefined
      : (input.api as Partial<Record<string, ProviderStreams>>);
  const images = input.images as Partial<Record<string, ProviderImages>> | undefined;
  const classifiers = input.classifiers as Partial<Record<string, ProviderClassifier>> | undefined;
  const streams =
    single === undefined
      ? Object.values(byApi ?? {}).filter((entry) => entry !== undefined)
      : [single];
  const imageImplementations = Object.values(images ?? {}).filter((entry) => entry !== undefined);
  const classifierImplementations = Object.values(classifiers ?? {}).filter(
    (entry) => entry !== undefined,
  );
  if (
    streams.length === 0 &&
    imageImplementations.length === 0 &&
    classifierImplementations.length === 0
  ) {
    throw new Error(
      `Provider ${input.id}: at least one of "api", "images", or "classifiers" is required.`,
    );
  }

  const baselineModels = input.models;
  let dynamicModels: readonly ProviderModel<TApi>[] = [];
  const fetchModels = input.fetchModels;
  const currentModels = (): readonly ProviderModel<TApi>[] => {
    const merged = [...baselineModels];
    for (const model of dynamicModels) {
      const index = merged.findIndex(
        (entry) => getModelType(entry) === getModelType(model) && entry.id === model.id,
      );
      if (index >= 0) merged[index] = model;
      else merged.push(model);
    }
    return merged;
  };
  const apiFor = (model: Model<Api>): ProviderStreams | undefined => single ?? byApi?.[model.api];

  const dispatch = (
    model: Model<Api>,
    run: (streams: ProviderStreams) => AssistantMessageEventStream,
  ): AssistantMessageEventStream => {
    const providerStreams = apiFor(model);
    if (providerStreams === undefined) {
      return lazyStream(model, () => {
        throw new ModelsError(
          "stream",
          `Provider ${input.id} has no API implementation for "${model.api}"`,
        );
      });
    }
    return run(providerStreams);
  };

  const provider: Provider<TApi> = {
    id: input.id,
    name: input.name ?? input.id,
    baseUrl: input.baseUrl,
    headers: input.headers,
    auth: input.auth,
    getModels: () =>
      currentModels().filter((model): model is Model<TApi> => isModelType(model, "chat")),
    getAllModels: currentModels,
    ...(input.filterModels === undefined ? {} : { filterModels: input.filterModels }),
    ...(input.filterAllModels === undefined ? {} : { filterAllModels: input.filterAllModels }),
    stream: (model, context, options) =>
      dispatch(model, (providerStreams) => providerStreams.stream(model, context, options)),
    streamSimple: (model, context, options) =>
      dispatch(model, (providerStreams) => providerStreams.streamSimple(model, context, options)),
  };

  if (fetchModels !== undefined) {
    provider.refreshModels = async (context) => {
      if (context.stored !== undefined) {
        const restored = context.stored.models
          .filter((model) => model.provider === input.id)
          .map((model) => model as ProviderModel<TApi>);
        if (
          !(await context.publish({
            update: () => {
              dynamicModels = restored;
            },
          }))
        ) {
          return;
        }
      }
      if (!context.allowNetwork || context.signal.aborted) return;
      const fetched = await fetchModels(context);
      if (context.signal.aborted) return;
      const refreshed = fetched.filter(hasKnownModelType);
      await context.publish({
        persist: { models: refreshed, checkedAt: Date.now() },
        update: () => {
          dynamicModels = refreshed;
        },
      });
    };
  }
  if (streams.some((entry) => entry.fetchDeferred !== undefined)) {
    provider.fetchDeferred = (model, handle, options) =>
      lazyStream(model, () => {
        const implementation = apiFor(model);
        if (implementation?.fetchDeferred === undefined) {
          throw new ModelsError(
            "provider",
            `Provider ${input.id} does not support deferred responses for "${model.api}"`,
          );
        }
        return implementation.fetchDeferred(model, handle, options);
      });
  }
  if (streams.some((entry) => entry.cancelDeferred !== undefined)) {
    provider.cancelDeferred = async (model, handle, options) => {
      const implementation = apiFor(model);
      if (implementation?.cancelDeferred === undefined) {
        throw new ModelsError(
          "provider",
          `Provider ${input.id} cannot cancel deferred responses for "${model.api}"`,
        );
      }
      await implementation.cancelDeferred(model, handle, options);
    };
  }
  if (images !== undefined && imageImplementations.length > 0) {
    provider.generateImages = (model, context, options) => {
      const implementation = images[model.api];
      if (implementation === undefined) {
        return Promise.resolve(
          imageErrorResult(
            model,
            new ModelsError(
              "provider",
              `Provider ${input.id} has no image generation implementation for "${model.api}"`,
            ),
          ),
        );
      }
      try {
        return implementation.generateImages(model, context, options);
      } catch (error) {
        return Promise.reject(error);
      }
    };
  }
  if (classifiers !== undefined && classifierImplementations.length > 0) {
    provider.classify = (model, context, options) => {
      const implementation = classifiers[model.api];
      if (implementation === undefined) {
        return Promise.resolve(
          classifierErrorResult(
            model,
            new ModelsError(
              "provider",
              `Provider ${input.id} has no classifier implementation for "${model.api}"`,
            ),
          ),
        );
      }
      try {
        return implementation.classify(model, context, options);
      } catch (error) {
        return Promise.reject(error);
      }
    };
  }

  return provider;
}

export function hasApi<TApi extends Api>(model: AnyModel, api: TApi): model is Model<TApi> {
  return isModelType(model, "chat") && model.api === api;
}

export function calculateCost(model: AnyModel, usage: Usage): Usage["cost"] {
  const inputTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  let rates: ModelCostRates = model.cost;
  let matchedThreshold = -1;
  for (const tier of model.cost.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
      rates = tier;
      matchedThreshold = tier.inputTokensAbove;
    }
  }

  const longWrite = usage.cacheWrite1h ?? 0;
  const shortWrite = usage.cacheWrite - longWrite;
  usage.cost.input = (rates.input / 1000000) * usage.input;
  usage.cost.output = (rates.output / 1000000) * usage.output;
  usage.cost.cacheRead = (rates.cacheRead / 1000000) * usage.cacheRead;
  usage.cost.cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1000000;
  usage.cost.total =
    usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
  return usage.cost;
}

const EXTENDED_THINKING_LEVELS: ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function getSupportedThinkingLevels<TApi extends Api>(
  model: Model<TApi>,
): ModelThinkingLevel[] {
  if (!model.reasoning) return ["off"];

  return EXTENDED_THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

export function clampThinkingLevel<TApi extends Api>(
  model: Model<TApi>,
  level: ModelThinkingLevel,
): ModelThinkingLevel {
  const availableLevels = getSupportedThinkingLevels(model);
  if (availableLevels.includes(level)) return level;

  const requestedIndex = EXTENDED_THINKING_LEVELS.indexOf(level);
  if (requestedIndex === -1) return availableLevels[0] ?? "off";

  for (const candidate of EXTENDED_THINKING_LEVELS.slice(requestedIndex)) {
    if (availableLevels.includes(candidate)) return candidate;
  }
  for (const candidate of EXTENDED_THINKING_LEVELS.slice(0, requestedIndex).reverse()) {
    if (availableLevels.includes(candidate)) return candidate;
  }
  return availableLevels[0] ?? "off";
}

export function modelsAreEqual(
  a: AnyModel | null | undefined,
  b: AnyModel | null | undefined,
): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return false;
  return getModelType(a) === getModelType(b) && a.id === b.id && a.provider === b.provider;
}
