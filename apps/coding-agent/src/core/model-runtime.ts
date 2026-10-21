import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import allModule from "@msa/ai/providers/all";
import openrouterUserModels from "@msa/ai/providers/openrouter-user-models";
import modelOperations from "@msa/ai/utils/model-operations";
import * as Effect from "effect/Effect";

import configModule from "../config.ts";
import abortModule from "../utils/abort.ts";
import errorsModule from "../utils/errors.ts";
import DefaultAuthStorage from "./auth-storage.ts";
import awaitingModule from "./awaiting.ts";
import cliAgents from "./cli-agents/index.ts";
import CredentialSynchronizationError from "./credential-synchronization-error.ts";
import FileModelsStore from "./file-models-store.ts";
import InMemoryCodingAgentModelsStore from "./in-memory-coding-agent-models-store.ts";
import ModelConfig from "./model-config.ts";
import type modelConfigTypes from "./model-config.types.ts";
import modelPolicy from "./model-policy.ts";
import type modelPolicyTypes from "./model-policy.types.ts";
import type modelRuntimeTypes from "./model-runtime.types.ts";
import platformNode from "./platform-node.ts";
import platform from "./platform.ts";
import processEnv from "./process-env.ts";
import providerComposer from "./provider-composer.ts";
import type providerComposerTypes from "./provider-composer.types.ts";
import providerModels from "./provider-composer/provider-models.ts";
import requestConfig from "./provider-composer/request-config.ts";
import remoteCatalogProvider from "./remote-catalog-provider.ts";
import RuntimeCredentials from "./runtime-credentials.ts";
import type runtimeCredentialsTypes from "./runtime-credentials.types.ts";
import virtualModelsModule from "./virtual-models.ts";
import type virtualModelsTypes from "./virtual-models.types.ts";

const { createVirtualModel, findLatestResponse, isVirtualModel, withVirtualModels } =
  virtualModelsModule;
const { composeModelProvider } = providerComposer;
const {
  configuredRequestAuthStatus,
  resolveCompatibilityRequestConfig,
  resolveConfiguredModelHeaders,
} = requestConfig;
const { validateExtensionProvider } = providerModels;
const { EMPTY_MODEL_POLICY, withModelPolicy } = modelPolicy;
const { awaited, awaiting, awaitingWith, performed } = awaitingModule;
const { dirname, join } = platformNode;
const { getAgentDir } = configModule;
const { withPersonalizedCatalog, withRemoteCatalog } = remoteCatalogProvider;
const { readEnv } = processEnv;
const { makeLatch, schedule } = platform;
const { toErrorMessage } = errorsModule;
const { cliAgentProviders } = cliAgents;
const { operationSignal, raceWithAbortSignal } = abortModule;
const { ModelsError, clampThinkingLevel, createModels, lazyStream, normalizeContext } = ai;
const { personalizeOpenRouterCatalog } = openrouterUserModels;
const { assertClassifierInputSupported, classifierErrorResult, imageErrorResult } = modelOperations;

const assertChatModel: typeof modelOperations.assertChatModel = modelOperations.assertChatModel;
const assertClassifierModel: typeof modelOperations.assertClassifierModel =
  modelOperations.assertClassifierModel;
const assertImageModel: typeof modelOperations.assertImageModel = modelOperations.assertImageModel;
interface RegisteredVirtualModel {
  model: aiTypes.Model<aiTypes.Api>;
  route: virtualModelsTypes.VirtualModelDefinition["route"];
}
interface ModelRuntimeSnapshot {
  all: readonly aiTypes.Model<aiTypes.Api>[];
  available: readonly aiTypes.Model<aiTypes.Api>[];
  configuredProviders: ReadonlySet<string>;
  storedProviders: ReadonlySet<string>;
  auth: ReadonlyMap<string, aiTypes.AuthCheck | undefined>;
}
function mergeHeaders(
  base: aiTypes.ProviderHeaders | undefined,
  override: aiTypes.ProviderHeaders | undefined,
): aiTypes.ProviderHeaders | undefined {
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
export default class ModelRuntime implements aiTypes.Models {
  private readonly models: aiTypes.MutableModels;
  private readonly credentials: runtimeCredentialsTypes.RuntimeCredentials;
  private readonly catalogProviders: readonly aiTypes.Provider[];
  private builtins: ReadonlyMap<string, aiTypes.Provider> = new Map();
  private readonly nativeExtensionProviders = new Map<string, aiTypes.Provider>();
  private readonly extensionProviders = new Map<
    string,
    providerComposerTypes.ProviderConfigInput
  >();
  private readonly virtualModels = new Map<string, Map<string, RegisteredVirtualModel>>();
  private readonly catalogProvidersById = new Map<string, aiTypes.Provider>();
  private policy: modelPolicyTypes.ModelPolicy = EMPTY_MODEL_POLICY;
  private readonly compositionErrors = new Map<string, string>();
  private readonly modelsPath: string | undefined;
  private readonly modelNetworkEnabled: boolean;
  private config: modelConfigTypes.ModelConfig;
  private snapshot: ModelRuntimeSnapshot = {
    all: [],
    auth: new Map(),
    available: [],
    configuredProviders: new Set(),
    storedProviders: new Set(),
  };
  private availabilityRefreshSeq = 0;
  private latestAvailabilityRefresh: { seq: number; pass: Promise<void> } | undefined;
  private availabilityErrorSeq = 0;
  private readonly providerAvailabilitySeq = new Map<string, number>();
  private availabilityError: string | undefined;
  private readonly credentialOperations = new Map<string, Promise<unknown>>();

  private constructor(
    credentials: runtimeCredentialsTypes.RuntimeCredentials,
    config: modelConfigTypes.ModelConfig,
    modelsPath: string | undefined,
    modelsStore: aiTypes.ModelsStore,
    providers: readonly aiTypes.Provider[],
    modelNetworkEnabled: boolean,
  ) {
    this.credentials = credentials;
    this.config = config;
    this.modelsPath = modelsPath;
    this.modelNetworkEnabled = modelNetworkEnabled;
    this.catalogProviders = providers;
    this.models = createModels({ credentials, modelsStore });
    this.rebuildProviders();
  }

  static create(options: modelRuntimeTypes.CreateModelRuntimeOptions = {}): Promise<ModelRuntime> {
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
        const builtinModelDataGeneratedAt = allModule.getBuiltinModelDataGeneratedAt();
        const providers = allModule.builtinProviders().map((provider) => {
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
          readEnv("MSA_OFFLINE") === undefined,
        );
        runtime.rebuildProviders();
        const refreshFromNetwork =
          runtime.modelNetworkEnabled && options.allowModelNetwork === true;
        const controller =
          refreshFromNetwork && options.modelRefreshTimeoutMs !== undefined
            ? new AbortController()
            : undefined;
        yield* ModelRuntime.initialRefresh(controller, options, runtime, refreshFromNetwork);
        return runtime;
      }),
    );
  }

  private static *initialRefresh(
    controller: AbortController | undefined,
    options: modelRuntimeTypes.CreateModelRuntimeOptions,
    runtime: ModelRuntime,
    refreshFromNetwork: boolean,
  ) {
    const timeout =
      controller === undefined
        ? undefined
        : schedule(() => controller.abort(), options.modelRefreshTimeoutMs ?? 0);
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
      if (timeout !== undefined) timeout.cancel();
    }
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

  private recomposeProvider(providerId: string): aiTypes.Provider | undefined {
    const provider = this.composeProvider(providerId);
    const virtualModels = [...(this.virtualModels.get(providerId)?.values() ?? [])].map(
      (entry) => entry.model,
    );
    const composed =
      virtualModels.length > 0 ? withVirtualModels(providerId, provider, virtualModels) : provider;
    if (composed === undefined) {
      this.models.deleteProvider(providerId);
      this.catalogProvidersById.delete(providerId);
      return undefined;
    }
    this.catalogProvidersById.set(providerId, composed);
    this.models.setProvider(withModelPolicy(composed, this.policy));
    return provider;
  }

  getModelPolicy(): modelPolicyTypes.ModelPolicy {
    return this.policy;
  }

  setModelPolicy(policy: modelPolicyTypes.ModelPolicy): void {
    if (
      policy.allow.join("\n") === this.policy.allow.join("\n") &&
      policy.deny.join("\n") === this.policy.deny.join("\n")
    ) {
      return;
    }
    this.policy = policy;
    this.rebuildProviders();
  }

  getCatalogModels(providerId?: string): readonly aiTypes.Model<aiTypes.Api>[] {
    const providers =
      providerId === undefined
        ? [...this.catalogProvidersById.values()]
        : [this.catalogProvidersById.get(providerId)].filter(
            (provider): provider is aiTypes.Provider => provider !== undefined,
          );
    return providers.flatMap((provider) => provider.getModels());
  }

  private composeProvider(providerId: string): aiTypes.Provider | undefined {
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
    this.builtins = new Map(
      [...this.catalogProviders, ...cliAgentProviders()].map((provider) => [provider.id, provider]),
    );
    this.models.clearProviders();
    this.compositionErrors.clear();
    this.catalogProvidersById.clear();
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
            providers.map((provider): Promise<[string, aiTypes.AuthCheck | undefined]> =>
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
          .filter((entry): entry is [string, aiTypes.AuthCheck] => entry[1] !== undefined)
          .map(([providerId]) => providerId),
      );
      this.snapshot = {
        all: [...this.models.getModels()],
        auth,
        available: [...available],
        configuredProviders,
        storedProviders: new Set(credentials.map((entry) => entry.providerId)),
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
    this.latestAvailabilityRefresh = { pass, seq };
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
          auth: authByProvider,
          available: all.flatMap(
            (model) => availableById.get(`${model.provider}\0${model.id}`) ?? [],
          ),
          configuredProviders,
          storedProviders,
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

  getProviders(): readonly aiTypes.Provider[] {
    return this.models.getProviders();
  }

  getProvider(providerId: string): aiTypes.Provider | undefined {
    return this.models.getProvider(providerId);
  }

  getModels(providerId?: string): readonly aiTypes.Model<aiTypes.Api>[] {
    return this.models.getModels(providerId);
  }

  getModel(providerId: string, modelId: string): aiTypes.Model<aiTypes.Api> | undefined {
    return this.models.getModel(providerId, modelId);
  }

  getModelsOfType<TType extends aiTypes.ModelType>(
    type: TType,
    providerId?: string,
  ): readonly aiTypes.ModelTypeMap[TType][] {
    return this.models.getModelsOfType(type, providerId);
  }

  getModelOfType<TType extends aiTypes.ModelType>(
    type: TType,
    providerId: string,
    modelId: string,
  ): aiTypes.ModelTypeMap[TType] | undefined {
    return this.models.getModelOfType(type, providerId, modelId);
  }

  getAllModels(providerId?: string): readonly aiTypes.AnyModel[] {
    return this.models.getAllModels(providerId);
  }

  getAvailableOfType<TType extends aiTypes.ModelType>(
    type: TType,
    providerId?: string,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<readonly aiTypes.ModelTypeMap[TType][]> {
    return this.models.getAvailableOfType(type, providerId, options);
  }

  getAllAvailable(
    providerId?: string,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<readonly aiTypes.AnyModel[]> {
    return this.models.getAllAvailable(providerId, options);
  }

  checkAuth(
    providerId: string,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.AuthCheck | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        return yield* awaited(this.models.checkAuth(providerId, options));
      }, this),
    );
  }

  getAvailable(
    providerId?: string,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<readonly aiTypes.Model<aiTypes.Api>[]> {
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

  getAvailableSnapshot(): readonly aiTypes.Model<aiTypes.Api>[] {
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

  getRegisteredProviderConfig(
    providerId: string,
  ): providerComposerTypes.ProviderConfigInput | undefined {
    return this.extensionProviders.get(providerId);
  }

  getRegisteredProviderIds(): readonly string[] {
    return [
      ...new Set([...this.extensionProviders.keys(), ...this.nativeExtensionProviders.keys()]),
    ];
  }

  getRegisteredNativeProvider(providerId: string): aiTypes.Provider | undefined {
    return this.nativeExtensionProviders.get(providerId);
  }

  getCompatibilityRequestConfig(
    model: aiTypes.Model<aiTypes.Api>,
  ): providerComposerTypes.CompatibilityRequestConfig {
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
    overrides?: modelRuntimeTypes.ModelRuntimeAuthOverrides,
  ): Promise<aiTypes.AuthResult | undefined>;
  getAuth(
    model: aiTypes.AnyModel,
    overrides?: modelRuntimeTypes.ModelRuntimeAuthOverrides,
  ): Promise<aiTypes.AuthResult | undefined>;
  getAuth(
    providerOrModel: string | aiTypes.AnyModel,
    overrides: modelRuntimeTypes.ModelRuntimeAuthOverrides = {},
  ): Promise<aiTypes.AuthResult | undefined> {
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
    const startedLatch = makeLatch();
    markStarted = startedLatch.open;
    const started = startedLatch.promise;
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
      return undefined;
    });
    return raceWithAbortSignal(started, signal).then(() => operation);
  }

  private synchronizeCredentialState(
    providerId: string,
    operation: modelRuntimeTypes.CredentialSynchronizationOperation,
    credential: aiTypes.Credential | undefined,
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
    options: aiTypes.AuthOperationOptions = {},
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
              { key: apiKey, type: "api_key" },
              signal,
            ),
          );
        }, this),
      ),
    );
  }

  removeRuntimeApiKey(
    providerId: string,
    options: aiTypes.AuthOperationOptions = {},
  ): Promise<void> {
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

  listCredentials(
    options?: aiTypes.AuthOperationOptions,
  ): Promise<readonly aiTypes.CredentialInfo[]> {
    return this.credentials.list(options);
  }

  getProviderAuthStatus(providerId: string): providerComposerTypes.AuthStatus {
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
      : { configured: true, label: check.source, source: "environment" };
  }

  private prepareRequest<
    TModel extends aiTypes.AnyModel,
    TOptions extends aiTypes.ProviderRequestOptions<TModel> & aiTypes.ModelsRequestTransforms,
  >(
    model: TModel,
    options: TOptions | undefined,
  ): Promise<{
    provider: aiTypes.Provider;
    model: TModel;
    options: Omit<TOptions, "transformHeaders"> & aiTypes.ProviderRequestOptions<TModel>;
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
          aiTypes.ProviderRequestOptions<TModel>;
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
          model: requestModel,
          options: {
            ...providerOptions,
            apiKey: providerOptions.apiKey ?? resolution.auth.apiKey,
            env,
            headers,
          } as Omit<TOptions, "transformHeaders"> & aiTypes.ProviderRequestOptions<TModel>,
          provider,
        };
      }, this),
    );
  }

  stream<TApi extends aiTypes.Api>(
    model: aiTypes.Model<TApi>,
    context: aiTypes.Context,
    options?: aiTypes.ModelsApiStreamOptions<TApi>,
  ): aiTypes.AssistantMessageEventStream {
    const transcript = normalizeContext(context);
    return lazyStream(model, () =>
      Effect.runPromise(
        awaitingWith(function* () {
          assertChatModel(model);
          const prepared = yield* awaited(
            this.prepareRequest(
              model,
              options as (aiTypes.StreamOptions & aiTypes.ModelsRequestTransforms) | undefined,
            ),
          );
          return prepared.provider.stream(
            prepared.model,
            transcript,
            prepared.options as aiTypes.ApiStreamOptions<TApi>,
          );
        }, this),
      ),
    );
  }

  complete<TApi extends aiTypes.Api>(
    model: aiTypes.Model<TApi>,
    context: aiTypes.Context,
    options?: aiTypes.ModelsApiStreamOptions<TApi>,
  ): Promise<aiTypes.AssistantMessage> {
    return this.stream(model, context, options).result();
  }

  streamSimple(
    model: aiTypes.Model<aiTypes.Api>,
    context: aiTypes.Context,
    options?: aiTypes.ModelsSimpleStreamOptions,
  ): aiTypes.AssistantMessageEventStream {
    const transcript = normalizeContext(context);
    if (isVirtualModel(model)) {
      return lazyStream(model, () =>
        Effect.runPromise(
          awaitingWith(function* () {
            const route = yield* awaited(
              this.resolveModel(model, transcript.messages, {
                reason: "direct",
                signal: options?.signal,
                thinkingLevel: options?.reasoning ?? "off",
              }),
            );
            const { maxTokens: limit } = route.model;
            const maxTokens =
              options?.maxTokens !== undefined && options?.maxTokens !== 0 && limit > 0
                ? Math.min(options.maxTokens, limit)
                : options?.maxTokens;
            const reasoning = route.thinkingLevel === "off" ? undefined : route.thinkingLevel;
            const { apiKey, headers, env, ...rest } = options ?? {};
            const auth = route.model.provider === model.provider ? { apiKey, env, headers } : {};
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
            prepared.options as aiTypes.SimpleStreamOptions,
          );
        }, this),
      ),
    );
  }

  completeSimple(
    model: aiTypes.Model<aiTypes.Api>,
    context: aiTypes.Context,
    options?: aiTypes.ModelsSimpleStreamOptions,
  ): Promise<aiTypes.AssistantMessage> {
    return this.streamSimple(model, context, options).result();
  }

  streamDeferred(
    model: aiTypes.Model<aiTypes.Api>,
    handle: aiTypes.DeferredHandle,
    options?: aiTypes.ModelsDeferredFetchOptions,
  ): aiTypes.AssistantMessageEventStream {
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
            prepared.options as aiTypes.DeferredFetchOptions,
          );
        }, this),
      ),
    );
  }

  fetchDeferred(
    model: aiTypes.Model<aiTypes.Api>,
    handle: aiTypes.DeferredHandle,
    options?: aiTypes.ModelsDeferredFetchOptions,
  ): Promise<aiTypes.AssistantMessage> {
    return Effect.runPromise(
      awaitingWith(function* () {
        return yield* awaited(this.streamDeferred(model, handle, options).result());
      }, this),
    );
  }

  cancelDeferred(
    model: aiTypes.Model<aiTypes.Api>,
    handle: aiTypes.DeferredHandle,
    options?: aiTypes.ModelsDeferredCancelOptions,
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
            prepared.options as aiTypes.DeferredCancelOptions,
          ),
        );
      }, this),
    );
  }

  countTokens(
    model: aiTypes.Model<aiTypes.Api>,
    context: aiTypes.Context,
    options?: aiTypes.ModelsSimpleStreamOptions,
  ): Promise<number | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        if (isVirtualModel(model)) return undefined;
        assertChatModel(model);
        const prepared = yield* awaited(this.prepareRequest(model, options));
        if (prepared.provider.countTokens === undefined) return undefined;
        return yield* awaited(
          prepared.provider.countTokens(
            prepared.model,
            normalizeContext(context),
            prepared.options as aiTypes.SimpleStreamOptions,
          ),
        );
      }, this),
    );
  }

  generateImages(
    model: aiTypes.ImageModel<aiTypes.ImageApi>,
    context: aiTypes.ImagesContext,
    options?: aiTypes.ModelsImagesOptions,
  ): Promise<aiTypes.AssistantImages> {
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
              prepared.options as aiTypes.ImagesOptions,
            ),
          );
        } catch (error) {
          return imageErrorResult(model, error, options?.signal?.aborted);
        }
      }, this),
    );
  }

  classify(
    model: aiTypes.ClassifierModel<aiTypes.ClassifierApi>,
    context: aiTypes.ClassifierContext,
    options?: aiTypes.ModelsClassifierOptions,
  ): Promise<aiTypes.ClassifierResult> {
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
              prepared.options as aiTypes.ClassifierOptions,
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
    type: aiTypes.AuthType,
    interaction: aiTypes.AuthInteraction,
    options?: aiTypes.LoginOptions,
  ): Promise<aiTypes.Credential> {
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

  logout(providerId: string, options: aiTypes.AuthOperationOptions = {}): Promise<void> {
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

  refresh(options: aiTypes.ModelsRefreshOptions = {}): Promise<aiTypes.ModelsRefreshResult> {
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
        const { errors, result } = yield* this.refreshModels(refreshOptions);
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

  private *refreshModels(refreshOptions: {
    allowNetwork: boolean;
    providers?: readonly string[];
    force?: boolean;
    signal?: AbortSignal;
  }) {
    const result = ((yield* awaited(this.models.refresh(refreshOptions))) as
      | aiTypes.ModelsRefreshResult
      | undefined) ?? {
      aborted: refreshOptions.signal?.aborted ?? false,
      errors: new Map(),
    };
    const errors = new Map(result.errors);
    return { errors, result };
  }

  registerNativeProvider(provider: aiTypes.Provider): void {
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
    configuredStatus: providerComposerTypes.AuthStatus | undefined,
    type: aiTypes.AuthType,
  ): void {
    if (!this.snapshot.storedProviders.has(providerId) && configuredStatus?.configured !== true)
      return;
    const configuredProviders = new Set(this.snapshot.configuredProviders).add(providerId);
    const auth = new Map(this.snapshot.auth);
    if (auth.get(providerId) === undefined)
      auth.set(providerId, { source: "configured provider", type });
    this.snapshot = {
      ...this.snapshot,
      auth,
      available: this.snapshot.all.filter((model) => configuredProviders.has(model.provider)),
      configuredProviders,
    };
  }

  registerProvider(providerId: string, config: providerComposerTypes.ProviderConfigInput): void {
    validateExtensionProvider(
      providerId,
      this.builtins.get(providerId),
      this.config.getProvider(providerId),
      config,
    );
    this.nativeExtensionProviders.delete(providerId);
    const previous = this.extensionProviders.get(providerId);
    const effective: providerComposerTypes.ProviderConfigInput = { ...previous };
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

  registerVirtualModel(definition: virtualModelsTypes.VirtualModelDefinition): void {
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
        source: "virtual",
        type: "api_key",
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
    model: aiTypes.Model<aiTypes.Api>,
    messages: readonly aiTypes.Message[],
    options: {
      reason: virtualModelsTypes.ModelRouteReason;
      thinkingLevel: aiTypes.ModelThinkingLevel;
      signal?: AbortSignal | undefined;
      failed?: aiTypes.AssistantMessage | undefined;
      state?: unknown;
    },
  ): Promise<virtualModelsTypes.ModelRoute> {
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
            failed: failedModel &&
              failed && {
                message: failed,
                model: failedModel,
                thinkingLevel: failed.thinkingLevel,
              },
            messages,
            model,
            previous: previousModel && {
              model: previousModel,
              thinkingLevel: latest?.thinkingLevel,
            },
          }),
        );
        const target = this.getPhysicalModel(route.model.provider, route.model.id);
        const routed = `${name} routed to ${route.model.provider}/${route.model.id}`;
        if (target === undefined) throw new Error(`${routed}, which is not a physical model.`);
        if (!this.hasConfiguredAuth(target.provider))
          throw new Error(`${routed}, which has no credentials.`);
        return {
          model: target,
          state: route.state,
          thinkingLevel: clampThinkingLevel(target, route.thinkingLevel),
        };
      }, this),
    );
  }

  getPhysicalModel(providerId: string, modelId: string): aiTypes.Model<aiTypes.Api> | undefined {
    const model = this.models.getModel(providerId, modelId);
    return model !== undefined && !isVirtualModel(model) ? model : undefined;
  }
}
