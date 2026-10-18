import { dirname, join } from "node:path";

import {
  type AnyModel,
  type Api,
  type ApiStreamOptions,
  type AssistantImages,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type AuthCheck,
  type AuthInteraction,
  type AuthOperationOptions,
  type AuthResult,
  type AuthType,
  type ClassifierApi,
  type ClassifierContext,
  type ClassifierModel,
  type ClassifierOptions,
  type ClassifierResult,
  type Context,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  clampThinkingLevel,
  createModels,
  type DeferredCancelOptions,
  type DeferredFetchOptions,
  type DeferredHandle,
  type ImageApi,
  type ImageModel,
  type ImagesContext,
  type ImagesOptions,
  type LoginOptions,
  lazyStream,
  type Message,
  type Model,
  type Models,
  type ModelsApiStreamOptions,
  type ModelsClassifierOptions,
  type ModelsDeferredCancelOptions,
  type ModelsDeferredFetchOptions,
  ModelsError,
  type ModelsImagesOptions,
  type ModelsRefreshOptions,
  type ModelsRefreshResult,
  type ModelsRequestTransforms,
  type ModelsSimpleStreamOptions,
  type ModelsStore,
  type ModelThinkingLevel,
  type ModelType,
  type ModelTypeMap,
  type MutableModels,
  normalizeContext,
  type Provider,
  type ProviderHeaders,
  type ProviderRequestOptions,
  type SimpleStreamOptions,
  type StreamOptions,
} from "@msa/ai";
import * as builtinProviderCatalog from "@msa/ai/providers/all";
import { personalizeOpenRouterCatalog } from "@msa/ai/providers/openrouter-user-models";
import {
  assertChatModel,
  assertClassifierInputSupported,
  assertClassifierModel,
  assertImageModel,
  classifierErrorResult,
  imageErrorResult,
} from "@msa/ai/utils/model-operations";
import * as Effect from "effect/Effect";

import { getAgentDir } from "../config.ts";
import { operationSignal, raceWithAbortSignal } from "../utils/abort.ts";
import { toErrorMessage } from "../utils/errors.ts";
import { AuthStorage as DefaultAuthStorage } from "./auth-storage.ts";
import { awaited, awaiting, awaitingWith, performed } from "./awaiting.ts";
import { ModelConfig } from "./model-config.ts";
import { FileModelsStore, InMemoryCodingAgentModelsStore } from "./models-store.ts";
import {
  type AuthStatus,
  type CompatibilityRequestConfig,
  composeModelProvider,
  configuredRequestAuthStatus,
  type ProviderConfigInput,
  resolveCompatibilityRequestConfig,
  resolveConfiguredModelHeaders,
  validateExtensionProvider,
} from "./provider-composer.ts";
import { withPersonalizedCatalog, withRemoteCatalog } from "./remote-catalog-provider.ts";
import { RuntimeCredentials } from "./runtime-credentials.ts";
import {
  createVirtualModel,
  findLatestResponse,
  isVirtualModel,
  type ModelRoute,
  type ModelRouteReason,
  type VirtualModelDefinition,
  withVirtualModels,
} from "./virtual-models.ts";

interface RegisteredVirtualModel {
  model: Model<Api>;
  route: VirtualModelDefinition["route"];
}

interface ModelRuntimeSnapshot {
  all: readonly Model<Api>[];
  available: readonly Model<Api>[];
  configuredProviders: ReadonlySet<string>;
  storedProviders: ReadonlySet<string>;
  auth: ReadonlyMap<string, AuthCheck | undefined>;
}

export interface CreateModelRuntimeOptions {
  credentials?: CredentialStore | undefined;
  authPath?: string | undefined;
  modelsPath?: string | null | undefined;
  modelsStore?: ModelsStore | undefined;
  modelsStorePath?: string | undefined;
  allowModelNetwork?: boolean | undefined;
  modelRefreshTimeoutMs?: number | undefined;
  catalogBaseUrl?: string | undefined;
  signal?: AbortSignal | undefined;
  refreshOnCreate?: boolean | undefined;
}

export interface ModelRuntimeAuthOverrides extends AuthOperationOptions {
  apiKey?: string | undefined;
  env?: Record<string, string> | undefined;
  minOAuthValidityMs?: number | undefined;
}

export type CredentialSynchronizationOperation =
  | "login"
  | "logout"
  | "setRuntimeApiKey"
  | "removeRuntimeApiKey";

export class CredentialSynchronizationError extends Error {
  readonly providerId: string;
  readonly operation: CredentialSynchronizationOperation;
  readonly credential: Credential | undefined;

  constructor(
    providerId: string,
    operation: CredentialSynchronizationOperation,
    credential: Credential | undefined,
    options: ErrorOptions,
  ) {
    super(
      `Credential ${operation} committed for ${providerId}, but local synchronization failed`,
      options,
    );
    this.name = "CredentialSynchronizationError";
    this.providerId = providerId;
    this.operation = operation;
    this.credential = credential;
  }
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

export class ModelRuntime implements Models {
  private readonly models: MutableModels;
  private readonly credentials: RuntimeCredentials;
  private readonly builtins: ReadonlyMap<string, Provider>;
  private readonly nativeExtensionProviders = new Map<string, Provider>();
  private readonly extensionProviders = new Map<string, ProviderConfigInput>();
  private readonly virtualModels = new Map<string, Map<string, RegisteredVirtualModel>>();
  private readonly compositionErrors = new Map<string, string>();
  private readonly modelsPath: string | undefined;
  private readonly modelNetworkEnabled: boolean;
  private config: ModelConfig;
  private snapshot: ModelRuntimeSnapshot = {
    all: [],
    available: [],
    configuredProviders: new Set(),
    storedProviders: new Set(),
    auth: new Map(),
  };
  private availabilityRefreshSeq = 0;
  private latestAvailabilityRefresh: { seq: number; pass: Promise<void> } | undefined;
  private availabilityErrorSeq = 0;
  private readonly providerAvailabilitySeq = new Map<string, number>();
  private availabilityError: string | undefined;
  private readonly credentialOperations = new Map<string, Promise<unknown>>();

  private constructor(
    credentials: RuntimeCredentials,
    config: ModelConfig,
    modelsPath: string | undefined,
    modelsStore: ModelsStore,
    providers: readonly Provider[],
    modelNetworkEnabled: boolean,
  ) {
    this.credentials = credentials;
    this.config = config;
    this.modelsPath = modelsPath;
    this.modelNetworkEnabled = modelNetworkEnabled;
    this.builtins = new Map(providers.map((provider) => [provider.id, provider]));
    this.models = createModels({ credentials, modelsStore });
    this.rebuildProviders();
  }

  static create(options: CreateModelRuntimeOptions = {}): Promise<ModelRuntime> {
    return Effect.runPromise(
      awaiting(function* () {
        const credentials = new RuntimeCredentials(
          options.credentials ?? DefaultAuthStorage.create(options.authPath),
        );
        const modelsPath =
          options.modelsPath === null
            ? undefined
            : (options.modelsPath ?? join(getAgentDir(), "models.json"));
        const config = yield* awaited(ModelConfig.load(modelsPath));
        const modelsStore =
          options.modelsStore ??
          (modelsPath !== undefined && modelsPath !== ""
            ? new FileModelsStore(
                options.modelsStorePath ?? join(dirname(modelsPath), "models-store.json"),
              )
            : new InMemoryCodingAgentModelsStore());
        const builtinModelDataGeneratedAt = builtinProviderCatalog.getBuiltinModelDataGeneratedAt();
        const providers = builtinProviderCatalog.builtinProviders().map((provider) => {
          if (provider.id === "openrouter") {
            return withPersonalizedCatalog(
              provider,
              personalizeOpenRouterCatalog,
              options.catalogBaseUrl,
              builtinModelDataGeneratedAt,
            );
          }
          return withRemoteCatalog(provider, options.catalogBaseUrl, builtinModelDataGeneratedAt);
        });
        const runtime = new ModelRuntime(
          credentials,
          config,
          modelsPath,
          modelsStore,
          providers,
          process.env["MSA_OFFLINE"] === undefined,
        );
        runtime.rebuildProviders();
        const refreshFromNetwork =
          runtime.modelNetworkEnabled && options.allowModelNetwork === true;
        const controller =
          refreshFromNetwork && options.modelRefreshTimeoutMs !== undefined
            ? new AbortController()
            : undefined;
        const timeout =
          controller === undefined
            ? undefined
            : setTimeout(() => controller.abort(), options.modelRefreshTimeoutMs);
        const signal =
          controller === undefined
            ? options.signal
            : options.signal === undefined
              ? controller.signal
              : AbortSignal.any([options.signal, controller.signal]);
        try {
          if (options.refreshOnCreate !== false) {
            yield* awaited(
              runtime.refresh({
                allowNetwork: refreshFromNetwork,
                ...(signal === undefined ? {} : { signal }),
              }),
            );
          }
        } finally {
          if (timeout !== undefined) clearTimeout(timeout);
        }
        return runtime;
      }),
    );
  }

  private providerIds(): Set<string> {
    return new Set([
      ...this.builtins.keys(),
      ...this.nativeExtensionProviders.keys(),
      ...this.config.getProviderIds(),
      ...this.extensionProviders.keys(),
      ...this.virtualModels.keys(),
    ]);
  }

  private recomposeProvider(providerId: string): Provider | undefined {
    const provider = this.composeProvider(providerId);
    const virtualModels = [...(this.virtualModels.get(providerId)?.values() ?? [])].map(
      (entry) => entry.model,
    );
    if (virtualModels.length > 0)
      this.models.setProvider(withVirtualModels(providerId, provider, virtualModels));
    else if (provider === undefined) this.models.deleteProvider(providerId);
    else this.models.setProvider(provider);
    return provider;
  }

  private composeProvider(providerId: string): Provider | undefined {
    const base = this.nativeExtensionProviders.get(providerId) ?? this.builtins.get(providerId);
    const extension = this.extensionProviders.get(providerId);
    if (this.config.getProvider(providerId) === undefined && extension === undefined) {
      this.compositionErrors.delete(providerId);
      return base;
    }
    try {
      const provider = composeModelProvider(providerId, base, this.config, extension);
      this.compositionErrors.delete(providerId);
      return provider;
    } catch (error) {
      this.compositionErrors.set(providerId, toErrorMessage(error));
      return base;
    }
  }

  private rebuildProviders(): void {
    this.models.clearProviders();
    this.compositionErrors.clear();
    for (const providerId of this.providerIds()) this.recomposeProvider(providerId);
    this.updateModelSnapshot();
  }

  private updateModelSnapshot(): void {
    const all = [...this.models.getModels()];
    this.snapshot = {
      ...this.snapshot,
      all,
      available: all.filter((model) => this.snapshot.configuredProviders.has(model.provider)),
    };
  }

  private runAvailabilityRefresh(
    seq: number,
    errorSeq: number,
    signal: AbortSignal,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      const providers = this.models.getProviders();
      const [available, checks, credentials] = yield* awaited(
        Promise.all([
          this.models.getAvailable(undefined, { signal }),
          Promise.all(
            providers.map((provider): Promise<[string, AuthCheck | undefined]> =>
              Effect.runPromise(
                awaitingWith(function* () {
                  return [
                    provider.id,
                    yield* awaited(this.models.checkAuth(provider.id, { signal })),
                  ];
                }, this),
              ),
            ),
          ),
          this.credentials.list({ signal }),
        ]),
      );
      if (seq !== this.availabilityRefreshSeq) {
        const latest = this.latestAvailabilityRefresh;
        if (latest !== undefined && latest.seq > seq) yield* awaited(latest.pass);
        return;
      }
      const auth = new Map(checks);
      const configuredProviders = new Set(
        checks
          .filter((entry): entry is [string, AuthCheck] => entry[1] !== undefined)
          .map(([providerId]) => providerId),
      );
      this.snapshot = {
        all: [...this.models.getModels()],
        available: [...available],
        configuredProviders,
        storedProviders: new Set(credentials.map((entry) => entry.providerId)),
        auth,
      };
      if (errorSeq === this.availabilityErrorSeq) this.availabilityError = undefined;
    }, this);
  }

  private queueAvailabilityRefresh(signal?: AbortSignal): Promise<void> {
    const seq = ++this.availabilityRefreshSeq;
    for (const [providerId, providerSeq] of this.providerAvailabilitySeq) {
      this.providerAvailabilitySeq.set(providerId, providerSeq + 1);
    }
    const errorSeq = ++this.availabilityErrorSeq;
    const effectiveSignal = operationSignal(signal);
    const pass = Effect.runPromise(
      this.runAvailabilityRefresh(seq, errorSeq, effectiveSignal),
    ).catch((error) => {
      if (errorSeq === this.availabilityErrorSeq && !effectiveSignal.aborted) {
        this.availabilityError = toErrorMessage(error);
      }
      throw error;
    });
    this.latestAvailabilityRefresh = { seq, pass };
    return pass;
  }

  private refreshProviderAvailability(
    providerId: string,
    signal: AbortSignal,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      ++this.availabilityRefreshSeq;
      const providerSeq = (this.providerAvailabilitySeq.get(providerId) ?? 0) + 1;
      this.providerAvailabilitySeq.set(providerId, providerSeq);
      const errorSeq = ++this.availabilityErrorSeq;
      try {
        const [available, auth, credential] = yield* awaited(
          Promise.all([
            this.models.getAvailable(providerId, { signal }),
            this.models.checkAuth(providerId, { signal }),
            this.credentials.read(providerId, { signal }),
          ]),
        );
        signal.throwIfAborted();
        if (this.providerAvailabilitySeq.get(providerId) !== providerSeq) return;
        const configuredProviders = new Set(this.snapshot.configuredProviders);
        const storedProviders = new Set(this.snapshot.storedProviders);
        const authByProvider = new Map(this.snapshot.auth);
        if (auth === undefined) {
          configuredProviders.delete(providerId);
          authByProvider.delete(providerId);
        } else {
          configuredProviders.add(providerId);
          authByProvider.set(providerId, auth);
        }
        if (credential === undefined) storedProviders.delete(providerId);
        else storedProviders.add(providerId);
        const all = [...this.models.getModels()];
        const availableById = new Map(
          [
            ...this.snapshot.available.filter((model) => model.provider !== providerId),
            ...available,
          ].map((model) => [`${model.provider}\0${model.id}`, model]),
        );
        this.snapshot = {
          all,
          available: all.flatMap(
            (model) => availableById.get(`${model.provider}\0${model.id}`) ?? [],
          ),
          configuredProviders,
          storedProviders,
          auth: authByProvider,
        };
        if (errorSeq === this.availabilityErrorSeq) this.availabilityError = undefined;
      } catch (error) {
        if (
          this.providerAvailabilitySeq.get(providerId) === providerSeq &&
          errorSeq === this.availabilityErrorSeq &&
          !signal.aborted
        ) {
          this.availabilityError = toErrorMessage(error);
        }
        throw error;
      }
    }, this);
  }

  getProviders(): readonly Provider[] {
    return this.models.getProviders();
  }

  getProvider(providerId: string): Provider | undefined {
    return this.models.getProvider(providerId);
  }

  getModels(providerId?: string): readonly Model<Api>[] {
    return this.models.getModels(providerId);
  }

  getModel(providerId: string, modelId: string): Model<Api> | undefined {
    return this.models.getModel(providerId, modelId);
  }

  getModelsOfType<TType extends ModelType>(
    type: TType,
    providerId?: string,
  ): readonly ModelTypeMap[TType][] {
    return this.models.getModelsOfType(type, providerId);
  }

  getModelOfType<TType extends ModelType>(
    type: TType,
    providerId: string,
    modelId: string,
  ): ModelTypeMap[TType] | undefined {
    return this.models.getModelOfType(type, providerId, modelId);
  }

  getAllModels(providerId?: string): readonly AnyModel[] {
    return this.models.getAllModels(providerId);
  }

  getAvailableOfType<TType extends ModelType>(
    type: TType,
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly ModelTypeMap[TType][]> {
    return this.models.getAvailableOfType(type, providerId, options);
  }

  getAllAvailable(
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly AnyModel[]> {
    return this.models.getAllAvailable(providerId, options);
  }

  checkAuth(providerId: string, options?: AuthOperationOptions): Promise<AuthCheck | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        return yield* awaited(this.models.checkAuth(providerId, options));
      }, this),
    );
  }

  getAvailable(
    providerId?: string,
    options?: AuthOperationOptions,
  ): Promise<readonly Model<Api>[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (providerId !== undefined && providerId !== "") {
          const errorSeq = ++this.availabilityErrorSeq;
          try {
            const available = yield* awaited(this.models.getAvailable(providerId, options));
            if (errorSeq === this.availabilityErrorSeq) this.availabilityError = undefined;
            return available;
          } catch (error) {
            if (errorSeq === this.availabilityErrorSeq && options?.signal?.aborted !== true) {
              this.availabilityError = toErrorMessage(error);
            }
            throw error;
          }
        }
        yield* awaited(this.queueAvailabilityRefresh(options?.signal));
        return this.snapshot.available;
      }, this),
    );
  }

  getAvailableSnapshot(): readonly Model<Api>[] {
    return this.snapshot.available;
  }

  getError(): string | undefined {
    const errors: string[] = [];
    const configError = this.config.getError();
    if (configError !== undefined && configError !== "") errors.push(configError);
    for (const [providerId, error] of this.compositionErrors) {
      errors.push(`Provider "${providerId}": ${error}`);
    }
    if (this.availabilityError !== undefined && this.availabilityError !== "")
      errors.push(`Availability refresh: ${this.availabilityError}`);
    return errors.length > 0 ? errors.join("\n\n") : undefined;
  }

  getRegisteredProviderConfig(providerId: string): ProviderConfigInput | undefined {
    return this.extensionProviders.get(providerId);
  }

  getRegisteredProviderIds(): readonly string[] {
    return [
      ...new Set([...this.extensionProviders.keys(), ...this.nativeExtensionProviders.keys()]),
    ];
  }

  getRegisteredNativeProvider(providerId: string): Provider | undefined {
    return this.nativeExtensionProviders.get(providerId);
  }

  getCompatibilityRequestConfig(model: Model<Api>): CompatibilityRequestConfig {
    return resolveCompatibilityRequestConfig(
      model,
      this.config.getProvider(model.provider),
      this.extensionProviders.get(model.provider),
    );
  }

  isUsingOAuth(providerId: string): boolean {
    return this.snapshot.auth.get(providerId)?.type === "oauth";
  }

  isUsingSubscription(providerId: string): boolean {
    return (
      this.isUsingOAuth(providerId) &&
      this.models.getProvider(providerId)?.auth.oauth?.isSubscription === true
    );
  }

  hasConfiguredAuth(providerId: string): boolean {
    return this.snapshot.configuredProviders.has(providerId);
  }

  getAuth(
    providerId: string,
    overrides?: ModelRuntimeAuthOverrides,
  ): Promise<AuthResult | undefined>;
  getAuth(model: AnyModel, overrides?: ModelRuntimeAuthOverrides): Promise<AuthResult | undefined>;
  getAuth(
    providerOrModel: string | AnyModel,
    overrides: ModelRuntimeAuthOverrides = {},
  ): Promise<AuthResult | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (typeof providerOrModel === "string")
          return yield* awaited(this.models.getAuth(providerOrModel, overrides));
        const resolution = yield* awaited(this.models.getAuth(providerOrModel, overrides));
        if (resolution === undefined) return undefined;
        const configuredHeaders = resolveConfiguredModelHeaders(
          providerOrModel,
          this.config.getProvider(providerOrModel.provider),
          this.extensionProviders.get(providerOrModel.provider),
          { ...(resolution.env ?? {}), ...(overrides.env ?? {}) },
        );
        return {
          ...resolution,
          auth: {
            ...resolution.auth,
            headers: mergeHeaders(resolution.auth.headers, configuredHeaders),
          },
        };
      }, this),
    );
  }

  private enqueueCredentialOperation<T>(
    providerId: string,
    signal: AbortSignal,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.credentialOperations.get(providerId) ?? Promise.resolve();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const operation = (() =>
      Effect.runPromise(
        awaiting(function* () {
          yield* awaited(previous.catch(() => {}));
          signal.throwIfAborted();
          markStarted?.();
          return yield* awaited(task());
        }),
      ))();
    const tail = operation.catch(() => {});
    this.credentialOperations.set(providerId, tail);
    void tail.then(() => {
      if (this.credentialOperations.get(providerId) === tail)
        this.credentialOperations.delete(providerId);
    });
    return raceWithAbortSignal(started, signal).then(() => operation);
  }

  private synchronizeCredentialState(
    providerId: string,
    operation: CredentialSynchronizationOperation,
    credential: Credential | undefined,
    signal: AbortSignal,
  ): Effect.Effect<void> {
    return awaitingWith(function* () {
      try {
        signal.throwIfAborted();
        this.recomposeProvider(providerId);
        const compositionError = this.compositionErrors.get(providerId);
        if (compositionError !== undefined && compositionError !== "")
          throw new Error(compositionError);
        const result = yield* awaited(
          this.models.refresh({
            allowNetwork: false,
            providers: [providerId],
            signal,
          }),
        );
        if (result.aborted) signal.throwIfAborted();
        const refreshError = result.errors.get(providerId);
        if (refreshError !== undefined) throw refreshError;
        this.updateModelSnapshot();
        yield* performed(this.refreshProviderAvailability(providerId, signal));
      } catch (cause) {
        throw new CredentialSynchronizationError(providerId, operation, credential, { cause });
      }
    }, this);
  }

  setRuntimeApiKey(
    providerId: string,
    apiKey: string,
    options: AuthOperationOptions = {},
  ): Promise<void> {
    const signal = operationSignal(options.signal);
    return this.enqueueCredentialOperation(providerId, signal, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          this.credentials.setRuntimeApiKey(providerId, apiKey);
          yield* performed(
            this.synchronizeCredentialState(
              providerId,
              "setRuntimeApiKey",
              { type: "api_key", key: apiKey },
              signal,
            ),
          );
        }, this),
      ),
    );
  }

  removeRuntimeApiKey(providerId: string, options: AuthOperationOptions = {}): Promise<void> {
    const signal = operationSignal(options.signal);
    return this.enqueueCredentialOperation(providerId, signal, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          this.credentials.removeRuntimeApiKey(providerId);
          yield* performed(
            this.synchronizeCredentialState(providerId, "removeRuntimeApiKey", undefined, signal),
          );
        }, this),
      ),
    );
  }

  listCredentials(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    return this.credentials.list(options);
  }

  getProviderAuthStatus(providerId: string): AuthStatus {
    if (this.credentials.hasRuntimeApiKey(providerId))
      return { configured: true, source: "runtime" };
    if (this.snapshot.storedProviders.has(providerId))
      return { configured: true, source: "stored" };
    const configured = configuredRequestAuthStatus(
      this.config.getProvider(providerId),
      this.extensionProviders.get(providerId),
    );
    if (configured !== undefined) return configured;
    const check = this.snapshot.auth.get(providerId);
    return check === undefined
      ? { configured: false }
      : { configured: true, source: "environment", label: check.source };
  }

  private prepareRequest<
    TModel extends AnyModel,
    TOptions extends ProviderRequestOptions<TModel> & ModelsRequestTransforms,
  >(
    model: TModel,
    options: TOptions | undefined,
  ): Promise<{
    provider: Provider;
    model: TModel;
    options: Omit<TOptions, "transformHeaders"> & ProviderRequestOptions<TModel>;
  }> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const provider = this.models.getProvider(model.provider);
        if (provider === undefined)
          throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
        const resolution = yield* awaited(
          this.getAuth(model, {
            apiKey: options?.apiKey,
            env: options?.env,
            ...(options?.signal === undefined ? {} : { signal: options.signal }),
          }),
        );
        if (resolution === undefined)
          throw new ModelsError("auth", `Provider is not configured: ${model.provider}`);

        const { transformHeaders, ...rawProviderOptions } = options ?? {};
        const providerOptions = rawProviderOptions as Omit<TOptions, "transformHeaders"> &
          ProviderRequestOptions<TModel>;
        let headers = mergeHeaders(resolution.auth.headers, providerOptions.headers);
        if (transformHeaders !== undefined)
          headers = yield* awaited(transformHeaders(headers ?? {}));
        const env =
          resolution.env !== undefined || providerOptions.env !== undefined
            ? { ...(resolution.env ?? {}), ...(providerOptions.env ?? {}) }
            : undefined;
        const requestModel: TModel =
          resolution.auth.baseUrl !== undefined && resolution.auth.baseUrl !== ""
            ? { ...model, baseUrl: resolution.auth.baseUrl }
            : model;
        return {
          provider,
          model: requestModel,
          options: {
            ...providerOptions,
            apiKey: providerOptions.apiKey ?? resolution.auth.apiKey,
            headers,
            env,
          } as Omit<TOptions, "transformHeaders"> & ProviderRequestOptions<TModel>,
        };
      }, this),
    );
  }

  stream<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): AssistantMessageEventStream {
    const transcript = normalizeContext(context);
    return lazyStream(model, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          assertChatModel(model);
          const prepared = yield* awaited(
            this.prepareRequest(
              model,
              options as (StreamOptions & ModelsRequestTransforms) | undefined,
            ),
          );
          return prepared.provider.stream(
            prepared.model,
            transcript,
            prepared.options as ApiStreamOptions<TApi>,
          );
        }, this),
      ),
    );
  }

  complete<TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: ModelsApiStreamOptions<TApi>,
  ): Promise<AssistantMessage> {
    return this.stream(model, context, options).result();
  }

  streamSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): AssistantMessageEventStream {
    const transcript = normalizeContext(context);
    if (isVirtualModel(model)) {
      return lazyStream(model, () =>
        Effect.runPromise(
          awaitingWith(function* () {
            const route = yield* awaited(
              this.resolveModel(model, transcript.messages, {
                reason: "direct",
                thinkingLevel: options?.reasoning ?? "off",
                signal: options?.signal,
              }),
            );
            const { maxTokens: limit } = route.model;
            const maxTokens =
              options?.maxTokens !== undefined && options?.maxTokens !== 0 && limit > 0
                ? Math.min(options.maxTokens, limit)
                : options?.maxTokens;
            const reasoning = route.thinkingLevel === "off" ? undefined : route.thinkingLevel;
            const { apiKey, headers, env, ...rest } = options ?? {};
            const auth = route.model.provider === model.provider ? { apiKey, headers, env } : {};
            return this.streamSimple(route.model, context, {
              ...rest,
              ...auth,
              maxTokens,
              reasoning,
            });
          }, this),
        ),
      );
    }
    return lazyStream(model, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          assertChatModel(model);
          const prepared = yield* awaited(this.prepareRequest(model, options));
          return prepared.provider.streamSimple(
            prepared.model,
            transcript,
            prepared.options as SimpleStreamOptions,
          );
        }, this),
      ),
    );
  }

  completeSimple(
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ): Promise<AssistantMessage> {
    return this.streamSimple(model, context, options).result();
  }

  streamDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredFetchOptions,
  ): AssistantMessageEventStream {
    return lazyStream(model, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          assertChatModel(model);
          const prepared = yield* awaited(this.prepareRequest(model, options));
          if (prepared.provider.fetchDeferred === undefined) {
            throw new ModelsError(
              "provider",
              `Provider ${model.provider} does not support deferred responses`,
            );
          }
          return prepared.provider.fetchDeferred(
            prepared.model,
            handle,
            prepared.options as DeferredFetchOptions,
          );
        }, this),
      ),
    );
  }

  fetchDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredFetchOptions,
  ): Promise<AssistantMessage> {
    return Effect.runPromise(
      awaitingWith(function* () {
        return yield* awaited(this.streamDeferred(model, handle, options).result());
      }, this),
    );
  }

  cancelDeferred(
    model: Model<Api>,
    handle: DeferredHandle,
    options?: ModelsDeferredCancelOptions,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        assertChatModel(model);
        const prepared = yield* awaited(this.prepareRequest(model, options));
        if (prepared.provider.cancelDeferred === undefined) {
          throw new ModelsError(
            "provider",
            `Provider ${model.provider} does not support deferred responses`,
          );
        }
        yield* awaited(
          prepared.provider.cancelDeferred(
            prepared.model,
            handle,
            prepared.options as DeferredCancelOptions,
          ),
        );
      }, this),
    );
  }

  generateImages(
    model: ImageModel<ImageApi>,
    context: ImagesContext,
    options?: ModelsImagesOptions,
  ): Promise<AssistantImages> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          assertImageModel(model);
          const prepared = yield* awaited(this.prepareRequest(model, options));
          if (prepared.provider.generateImages === undefined) {
            throw new ModelsError(
              "provider",
              `Provider ${model.provider} does not support image generation`,
            );
          }
          return yield* awaited(
            prepared.provider.generateImages(
              prepared.model,
              context,
              prepared.options as ImagesOptions,
            ),
          );
        } catch (error) {
          return imageErrorResult(model, error, options?.signal?.aborted);
        }
      }, this),
    );
  }

  classify(
    model: ClassifierModel<ClassifierApi>,
    context: ClassifierContext,
    options?: ModelsClassifierOptions,
  ): Promise<ClassifierResult> {
    return Effect.runPromise(
      awaitingWith(function* () {
        try {
          assertClassifierModel(model);
          assertClassifierInputSupported(model, context);
          const prepared = yield* awaited(this.prepareRequest(model, options));
          if (prepared.provider.classify === undefined) {
            throw new ModelsError(
              "provider",
              `Provider ${model.provider} does not support classification`,
            );
          }
          return yield* awaited(
            prepared.provider.classify(
              prepared.model,
              context,
              prepared.options as ClassifierOptions,
            ),
          );
        } catch (error) {
          return classifierErrorResult(model, error, options?.signal?.aborted);
        }
      }, this),
    );
  }

  login(
    providerId: string,
    type: AuthType,
    interaction: AuthInteraction,
    options?: LoginOptions,
  ): Promise<Credential> {
    const signal = operationSignal(interaction.signal);
    return this.enqueueCredentialOperation(providerId, signal, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          const credential = yield* awaited(
            this.models.login(providerId, type, { ...interaction, signal }, options),
          );
          yield* performed(
            this.synchronizeCredentialState(providerId, "login", credential, signal),
          );
          return credential;
        }, this),
      ),
    );
  }

  logout(providerId: string, options: AuthOperationOptions = {}): Promise<void> {
    const signal = operationSignal(options.signal);
    return this.enqueueCredentialOperation(providerId, signal, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          yield* awaited(this.models.logout(providerId, { signal }));
          yield* performed(
            this.synchronizeCredentialState(providerId, "logout", undefined, signal),
          );
        }, this),
      ),
    );
  }

  refresh(options: ModelsRefreshOptions = {}): Promise<ModelsRefreshResult> {
    return Effect.runPromise(
      awaitingWith(function* () {
        this.config = yield* awaited(ModelConfig.load(this.modelsPath));
        if (options.providers === undefined) {
          this.rebuildProviders();
        } else {
          for (const providerId of new Set(options.providers)) this.recomposeProvider(providerId);
          this.updateModelSnapshot();
        }
        const refreshOptions = {
          ...options,
          allowNetwork: options.allowNetwork ?? this.modelNetworkEnabled,
        };
        const result = ((yield* awaited(this.models.refresh(refreshOptions))) as
          | ModelsRefreshResult
          | undefined) ?? {
          aborted: refreshOptions.signal?.aborted ?? false,
          errors: new Map(),
        };
        const errors = new Map(result.errors);
        this.updateModelSnapshot();
        if (options.providers === undefined) {
          try {
            yield* awaited(this.queueAvailabilityRefresh(options.signal));
          } catch {}
        } else {
          yield* awaited(
            Promise.all(
              [...new Set(options.providers)].map((providerId) =>
                Effect.runPromise(
                  awaitingWith(function* () {
                    try {
                      yield* performed(
                        this.refreshProviderAvailability(
                          providerId,
                          operationSignal(options.signal),
                        ),
                      );
                    } catch (error) {
                      if (options.signal?.aborted !== true) {
                        errors.set(
                          providerId,
                          error instanceof Error ? error : new Error(String(error)),
                        );
                      }
                    }
                  }, this),
                ),
              ),
            ),
          );
        }
        return { aborted: result.aborted || (options.signal?.aborted ?? false), errors };
      }, this),
    );
  }

  registerNativeProvider(provider: Provider): void {
    if (provider.id.trim() === "") throw new Error("Provider id must not be empty.");
    this.extensionProviders.delete(provider.id);
    this.nativeExtensionProviders.set(provider.id, provider);
    this.recomposeProvider(provider.id);
    this.updateModelSnapshot();
    this.markProvisionallyConfigured(
      provider.id,
      configuredRequestAuthStatus(this.config.getProvider(provider.id), undefined),
      provider.auth.oauth !== undefined && provider.auth.apiKey === undefined ? "oauth" : "api_key",
    );
    void this.refresh({ allowNetwork: false });
  }

  private markProvisionallyConfigured(
    providerId: string,
    configuredStatus: AuthStatus | undefined,
    type: AuthType,
  ): void {
    if (!this.snapshot.storedProviders.has(providerId) && configuredStatus?.configured !== true)
      return;
    const configuredProviders = new Set(this.snapshot.configuredProviders).add(providerId);
    const auth = new Map(this.snapshot.auth);
    if (auth.get(providerId) === undefined)
      auth.set(providerId, { type, source: "configured provider" });
    this.snapshot = {
      ...this.snapshot,
      auth,
      configuredProviders,
      available: this.snapshot.all.filter((model) => configuredProviders.has(model.provider)),
    };
  }

  registerProvider(providerId: string, config: ProviderConfigInput): void {
    validateExtensionProvider(
      providerId,
      this.builtins.get(providerId),
      this.config.getProvider(providerId),
      config,
    );
    this.nativeExtensionProviders.delete(providerId);
    const previous = this.extensionProviders.get(providerId);
    const effective: ProviderConfigInput = { ...previous };
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined) (effective as Record<string, unknown>)[key] = value;
    }
    this.extensionProviders.set(providerId, effective);
    this.recomposeProvider(providerId);
    this.updateModelSnapshot();
    this.markProvisionallyConfigured(
      providerId,
      configuredRequestAuthStatus(this.config.getProvider(providerId), effective),
      effective.oauth !== undefined && (effective.apiKey === undefined || effective.apiKey === "")
        ? "oauth"
        : "api_key",
    );
    void this.refresh({ allowNetwork: false });
  }

  unregisterProvider(providerId: string): void {
    this.extensionProviders.delete(providerId);
    this.nativeExtensionProviders.delete(providerId);
    this.recomposeProvider(providerId);
    this.updateModelSnapshot();
    void this.refresh({ allowNetwork: false });
  }

  registerVirtualModel(definition: VirtualModelDefinition): void {
    const { provider: providerId, id } = definition;
    if (providerId.trim() === "" || id.trim() === "")
      throw new Error("Virtual model provider and id must not be empty.");
    const existing = this.models.getModel(providerId, id);
    if (existing !== undefined && !isVirtualModel(existing)) {
      throw new Error(`Virtual model ${providerId}/${id} conflicts with a physical model.`);
    }
    const models = this.virtualModels.get(providerId) ?? new Map<string, RegisteredVirtualModel>();
    models.set(id, {
      model: createVirtualModel(definition),
      route: (request) => definition.route(request),
    });
    this.virtualModels.set(providerId, models);
    if (
      this.recomposeProvider(providerId) === undefined &&
      !this.snapshot.configuredProviders.has(providerId)
    ) {
      const auth = new Map(this.snapshot.auth).set(providerId, {
        type: "api_key",
        source: "virtual",
      });
      const configuredProviders = new Set(this.snapshot.configuredProviders).add(providerId);
      this.snapshot = { ...this.snapshot, auth, configuredProviders };
    }
    this.updateModelSnapshot();
    void this.refresh({ allowNetwork: false });
  }

  unregisterVirtualModel(providerId: string, id: string): void {
    const models = this.virtualModels.get(providerId);
    if (models?.delete(id) !== true) return;
    if (models.size === 0) this.virtualModels.delete(providerId);
    this.recomposeProvider(providerId);
    this.updateModelSnapshot();
    void this.refresh({ allowNetwork: false });
  }

  resolveModel(
    model: Model<Api>,
    messages: readonly Message[],
    options: {
      reason: ModelRouteReason;
      thinkingLevel: ModelThinkingLevel;
      signal?: AbortSignal | undefined;
      failed?: AssistantMessage | undefined;
      state?: unknown;
    },
  ): Promise<ModelRoute> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const name = `Virtual model ${model.provider}/${model.id}`;
        const virtual = this.virtualModels.get(model.provider)?.get(model.id);
        if (virtual === undefined) throw new Error(`${name} is not registered.`);
        const { failed, ...request } = options;
        const latest = findLatestResponse(messages);
        const previousModel = latest && this.getPhysicalModel(latest.provider, latest.model);
        const failedModel = failed && this.getPhysicalModel(failed.provider, failed.model);
        const route = yield* awaited(
          virtual.route({
            ...request,
            model,
            previous: previousModel && {
              model: previousModel,
              thinkingLevel: latest?.thinkingLevel,
            },
            failed: failedModel &&
              failed && {
                model: failedModel,
                thinkingLevel: failed.thinkingLevel,
                message: failed,
              },
            messages,
          }),
        );
        const target = this.getPhysicalModel(route.model.provider, route.model.id);
        const routed = `${name} routed to ${route.model.provider}/${route.model.id}`;
        if (target === undefined) throw new Error(`${routed}, which is not a physical model.`);
        if (!this.hasConfiguredAuth(target.provider))
          throw new Error(`${routed}, which has no credentials.`);
        return {
          model: target,
          thinkingLevel: clampThinkingLevel(target, route.thinkingLevel),
          state: route.state,
        };
      }, this),
    );
  }

  getPhysicalModel(providerId: string, modelId: string): Model<Api> | undefined {
    const model = this.models.getModel(providerId, modelId);
    return model !== undefined && !isVirtualModel(model) ? model : undefined;
  }
}
