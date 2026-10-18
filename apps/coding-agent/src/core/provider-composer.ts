import {
  type AnyModel,
  type Api,
  type ApiKeyAuth,
  type AssistantMessageEventStream,
  type AuthContext,
  type AuthInteraction,
  type AuthResult,
  type ClassifierApi,
  type Credential,
  type ImageApi,
  isModelType,
  lazyStream,
  type Model,
  type ModelAuth,
  type OAuthAuth,
  type OAuthCredentials,
  type OAuthLoginCallbacks,
  type Provider,
  type ProviderClassifier,
  type ProviderHeaders,
  type ProviderImages,
  type RefreshModelsContext,
  type SimpleStreamOptions,
  type StreamOptions,
  type TranscriptContext,
} from "@msa/ai";
import { getApiProvider } from "@msa/ai/compat";
import { classifierErrorResult, imageErrorResult } from "@msa/ai/utils/model-operations";
import * as Effect from "effect/Effect";

import { awaited, awaiting, performed } from "./awaiting.ts";
import type {
  ModelConfig,
  ModelsJsonModel,
  ModelsJsonModelOverride,
  ModelsJsonProvider,
} from "./model-config.ts";
import {
  clearConfigValueCache,
  getConfigValueEnvVarNames,
  isCommandConfigValue,
  isConfigValueConfigured,
  resolveConfigValueOrThrow,
  resolveHeadersOrThrow,
} from "./resolve-config-value.ts";

export interface ExtensionOAuthConfig {
  name: string;
  isSubscription?: boolean;
  usesCallbackServer?: boolean;
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
  refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials>;
  getApiKey(credentials: OAuthCredentials): string;
  modifyModels?(models: Model<Api>[], credentials: OAuthCredentials): Model<Api>[];
}

interface ProviderModelConfigBase {
  id: string;
  name: string;
  api?: string;
  baseUrl?: string;
  input: ("text" | "image")[];
  inputLimits?: NonNullable<AnyModel["inputLimits"]>;
  cost: AnyModel["cost"];
  headers?: Record<string, string>;
}

export interface ProviderChatModelConfig extends ProviderModelConfigBase {
  type?: "chat";
  api?: Api;
  reasoning: boolean;
  thinkingLevelMap?: NonNullable<Model<Api>["thinkingLevelMap"]>;
  promptCache?: NonNullable<Model<Api>["promptCache"]>;
  contextWindow: number;
  maxTokens: number;
  samplingParams?: NonNullable<Model<Api>["samplingParams"]>;
  samplingParamsByThinkingLevel?: NonNullable<Model<Api>["samplingParamsByThinkingLevel"]>;
  compat?: Model<Api>["compat"];
}

export interface ProviderImageModelConfig extends ProviderModelConfigBase {
  type: "image";
  api?: ImageApi;
  output: ("text" | "image")[];
}

export interface ProviderClassifierModelConfig extends ProviderModelConfigBase {
  type: "classifier";
  api?: ClassifierApi;
  contextWindow: number;
}

export type ProviderModelConfig =
  | ProviderChatModelConfig
  | ProviderImageModelConfig
  | ProviderClassifierModelConfig;

export interface ProviderConfigInput {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  api?: Api;
  streamSimple?: (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream;
  images?: Partial<Record<ImageApi, ProviderImages>>;
  classifiers?: Partial<Record<ClassifierApi, ProviderClassifier>>;
  headers?: Record<string, string>;
  authHeader?: boolean;
  oauth?: ExtensionOAuthConfig;
  models?: ProviderModelConfig[];
  refreshModels?(context: RefreshModelsContext): Promise<ProviderModelConfig[]>;
}

export type AuthStatus = {
  configured: boolean;
  source?:
    | "stored"
    | "runtime"
    | "environment"
    | "fallback"
    | "models_json_key"
    | "models_json_command";
  label?: string | undefined;
};

export const clearApiKeyCache = clearConfigValueCache;

function getAllProviderModels(provider: Provider | undefined): readonly AnyModel[] {
  return provider === undefined ? [] : (provider.getAllModels?.() ?? provider.getModels());
}

function mergeCompat(
  base: Model<Api>["compat"],
  override: Model<Api>["compat"] | ModelsJsonModelOverride["compat"],
): Model<Api>["compat"] {
  if (override === undefined) return base;
  const merged = { ...base, ...override } as NonNullable<Model<Api>["compat"]>;
  const baseNested = base as Record<string, unknown> | undefined;
  const overrideNested = override as Record<string, unknown>;
  const mergedNested = merged as Record<string, unknown>;
  for (const key of ["openRouterRouting", "chatTemplateKwargs"] as const) {
    const baseValue = baseNested?.[key];
    const overrideValue = overrideNested[key];
    if (
      (typeof baseValue === "object" && baseValue !== null) ||
      (typeof overrideValue === "object" && overrideValue !== null)
    ) {
      mergedNested[key] = {
        ...(baseValue as object | undefined),
        ...(overrideValue as object | undefined),
      };
    }
  }
  return merged;
}

function mergeInputLimits(
  base: Model<Api>["inputLimits"],
  override: ModelsJsonModelOverride["inputLimits"],
): Model<Api>["inputLimits"] {
  if (override === undefined) return base;
  return {
    ...base,
    ...override,
    ...(override.images === undefined
      ? {}
      : {
          images: {
            ...base?.images,
            ...override.images,
            ...(override.images.resize === undefined
              ? {}
              : { resize: { ...base?.images?.resize, ...override.images.resize } }),
          },
        }),
  };
}

function mergeSamplingParamsByThinkingLevel(
  base: Model<Api>["samplingParamsByThinkingLevel"],
  override: Model<Api>["samplingParamsByThinkingLevel"],
): Model<Api>["samplingParamsByThinkingLevel"] {
  if (override === undefined) return base;
  const merged = { ...base };
  for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
    const params = override[level];
    if (params !== undefined) merged[level] = { ...base?.[level], ...params };
  }
  return merged;
}

function applyModelOverride(model: Model<Api>, override: ModelsJsonModelOverride): Model<Api> {
  const inputLimits = mergeInputLimits(model.inputLimits, override.inputLimits);
  const tiers = override.cost?.tiers ?? model.cost.tiers;
  const samplingParamsByThinkingLevel = mergeSamplingParamsByThinkingLevel(
    model.samplingParamsByThinkingLevel,
    override.samplingParamsByThinkingLevel,
  );
  const compat = mergeCompat(model.compat, override.compat);
  return {
    ...model,
    name: override.name ?? model.name,
    reasoning: override.reasoning ?? model.reasoning,
    ...(override.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: { ...model.thinkingLevelMap, ...override.thinkingLevelMap } }),
    input: (override.input as ("text" | "image")[] | undefined) ?? model.input,
    ...(inputLimits === undefined ? {} : { inputLimits }),
    cost:
      override.cost === undefined
        ? model.cost
        : {
            input: override.cost.input ?? model.cost.input,
            output: override.cost.output ?? model.cost.output,
            cacheRead: override.cost.cacheRead ?? model.cost.cacheRead,
            cacheWrite: override.cost.cacheWrite ?? model.cost.cacheWrite,
            ...(tiers === undefined ? {} : { tiers }),
          },
    ...(override.promptCache === undefined
      ? {}
      : { promptCache: { ...model.promptCache, ...override.promptCache } }),
    contextWindow: override.contextWindow ?? model.contextWindow,
    maxTokens: override.maxTokens ?? model.maxTokens,
    ...(override.samplingParams === undefined
      ? {}
      : { samplingParams: { ...model.samplingParams, ...override.samplingParams } }),
    ...(samplingParamsByThinkingLevel === undefined ? {} : { samplingParamsByThinkingLevel }),
    ...(compat === undefined ? {} : { compat }),
  };
}

function modelFromJson(
  providerId: string,
  definition: ModelsJsonModel,
  providerConfig: ModelsJsonProvider,
  defaults: Model<Api> | undefined,
): Model<Api> {
  const api = definition.api ?? providerConfig.api ?? defaults?.api;
  if (api === undefined || api === "") {
    throw new Error(
      `Provider ${providerId}, model ${definition.id}: no "api" specified. Set at provider or model level.`,
    );
  }
  const baseUrl = definition.baseUrl ?? providerConfig.baseUrl ?? defaults?.baseUrl;
  if (baseUrl === undefined || baseUrl === "")
    throw new Error(`Provider ${providerId}: "baseUrl" is required when defining custom models.`);
  if (definition.contextWindow !== undefined && definition.contextWindow <= 0) {
    throw new Error(`Provider ${providerId}, model ${definition.id}: invalid contextWindow`);
  }
  if (definition.maxTokens !== undefined && definition.maxTokens <= 0) {
    throw new Error(`Provider ${providerId}, model ${definition.id}: invalid maxTokens`);
  }
  const compat = mergeCompat(providerConfig.compat, definition.compat);
  return {
    id: definition.id,
    name: definition.name ?? definition.id,
    api: api as Api,
    provider: providerId,
    baseUrl,
    reasoning: definition.reasoning ?? false,
    ...(definition.thinkingLevelMap === undefined
      ? {}
      : { thinkingLevelMap: definition.thinkingLevelMap }),
    input: (definition.input ?? ["text"]) as ("text" | "image")[],
    ...(definition.inputLimits === undefined ? {} : { inputLimits: definition.inputLimits }),
    cost: definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(definition.promptCache === undefined ? {} : { promptCache: definition.promptCache }),
    contextWindow: definition.contextWindow ?? 128000,
    maxTokens: definition.maxTokens ?? 16384,
    ...(definition.samplingParams === undefined
      ? {}
      : { samplingParams: definition.samplingParams }),
    ...(definition.samplingParamsByThinkingLevel === undefined
      ? {}
      : { samplingParamsByThinkingLevel: definition.samplingParamsByThinkingLevel }),
    ...(compat === undefined ? {} : { compat }),
  };
}

function findModelDefaults(
  models: readonly AnyModel[],
  modelId: string,
  api?: Api,
): Model<Api> | undefined {
  const chatModels = models.filter((model) => isModelType(model, "chat"));
  return (
    chatModels.find((model) => model.id === modelId) ??
    (api === undefined ? undefined : chatModels.find((model) => model.api === api)) ??
    chatModels.find((model) => model.api === "openai-completions") ??
    chatModels[0]
  );
}

function findExtensionModelDefaults(
  models: readonly AnyModel[],
  definition: ProviderModelConfig,
): AnyModel | undefined {
  const type = definition.type ?? "chat";
  const candidates = models.filter((model) => isModelType(model, type));
  return (
    candidates.find((model) => model.id === definition.id) ??
    (definition.api === undefined
      ? undefined
      : candidates.find((model) => model.api === definition.api)) ??
    (type === "chat"
      ? candidates.find((model) => model.api === "openai-completions")
      : undefined) ??
    candidates[0]
  );
}

function extensionModelFromDefinition(
  providerId: string,
  models: readonly AnyModel[],
  config: ProviderConfigInput,
  definition: ProviderModelConfig,
): AnyModel {
  const type = definition.type ?? "chat";
  const defaults = findExtensionModelDefaults(models, definition);
  const api = definition.api ?? (type === "chat" ? config.api : undefined) ?? defaults?.api;
  if (api === undefined) {
    throw new Error(
      `Provider ${providerId}, model ${definition.id}: no "api" specified. Set it at model level${type === "chat" ? " or provider level" : ""}.`,
    );
  }
  const baseUrl = definition.baseUrl ?? config.baseUrl ?? defaults?.baseUrl;
  if (baseUrl === undefined || baseUrl === "")
    throw new Error(`Provider ${providerId}: "baseUrl" is required when defining custom models.`);
  const { headers: _headers, ...fields } = definition;
  if (fields.type === "image") {
    return { ...fields, api: api as ImageApi, provider: providerId, baseUrl };
  }
  if (fields.type === "classifier") {
    return { ...fields, api: api as ClassifierApi, provider: providerId, baseUrl };
  }
  return { ...fields, api: api as Api, provider: providerId, baseUrl };
}

function applyModelsJson(
  providerId: string,
  baseModels: readonly AnyModel[],
  config: ModelsJsonProvider | undefined,
): AnyModel[] {
  if (config === undefined) return [...baseModels];
  const hasOverrides = config.modelOverrides && Object.keys(config.modelOverrides).length > 0;
  if (
    (config.models?.length === undefined || config.models?.length === 0) &&
    (config.baseUrl === undefined || config.baseUrl === "") &&
    config.headers === undefined &&
    config.compat === undefined &&
    hasOverrides !== true &&
    (config.apiKey === undefined || config.apiKey === "") &&
    config.authHeader === undefined
  ) {
    throw new Error(
      `Provider ${providerId}: must specify "baseUrl", "headers", "compat", "modelOverrides", or "models".`,
    );
  }

  const models: AnyModel[] = baseModels.map((model) => {
    const baseUrl = config.baseUrl ?? model.baseUrl;
    return isModelType(model, "chat")
      ? { ...model, baseUrl, compat: mergeCompat(model.compat, config.compat) }
      : { ...model, baseUrl };
  });
  for (const definition of config.models ?? []) {
    const existingIndex = models.findIndex(
      (model) => isModelType(model, "chat") && model.id === definition.id,
    );
    const defaults = findModelDefaults(models, definition.id, definition.api ?? config.api);
    const model = modelFromJson(providerId, definition, config, defaults);
    if (existingIndex >= 0) models[existingIndex] = model;
    else models.push(model);
  }
  return models;
}

function applyExtension(
  providerId: string,
  models: readonly AnyModel[],
  config: ProviderConfigInput | undefined,
): AnyModel[] {
  if (config === undefined) return [...models];
  if (config.models === undefined) {
    return config.baseUrl !== undefined && config.baseUrl !== ""
      ? models.map((model) => ({ ...model, baseUrl: config.baseUrl! }))
      : [...models];
  }
  return config.models.map((definition) =>
    extensionModelFromDefinition(providerId, models, config, definition),
  );
}

function adaptOAuth(config: ExtensionOAuthConfig): OAuthAuth {
  return {
    name: config.name,
    isSubscription: config.isSubscription,
    login: (callbacks) =>
      Effect.runPromise(
        awaiting(function* () {
          const credential = yield* awaited(
            config.login({
              onAuth: (info) => callbacks.notify({ type: "auth_url", ...info }),
              onDeviceCode: (info) => callbacks.notify({ type: "device_code", ...info }),
              onPrompt: (prompt) => callbacks.prompt({ type: "text", ...prompt }),
              onProgress: (message) => callbacks.notify({ type: "progress", message }),
              onManualCodeInput: () =>
                callbacks.prompt({ type: "manual_code", message: "Paste the authorization code" }),
              onSelect: (prompt) => callbacks.prompt({ type: "select", ...prompt }),
              signal: callbacks.signal,
            }),
          );
          return { ...credential, type: "oauth" };
        }),
      ),
    refresh: (credential, signal) =>
      Effect.runPromise(
        awaiting(function* () {
          return {
            ...(yield* awaited(config.refreshToken(credential, signal))),
            type: "oauth",
          };
        }),
      ),
    toAuth: (credential) =>
      Effect.runPromise(Effect.sync(() => ({ apiKey: config.getApiKey(credential) }))),
  };
}

function withConfiguredAuth(
  auth: ModelAuth,
  headers: Record<string, string> | undefined,
  authHeader: boolean,
): ModelAuth {
  let mergedHeaders: ProviderHeaders | undefined =
    auth.headers !== undefined || headers !== undefined
      ? { ...auth.headers, ...headers }
      : undefined;
  if (authHeader) {
    if (auth.apiKey === undefined || auth.apiKey === "")
      throw new Error("authHeader requires a resolved API key");
    mergedHeaders = { ...mergedHeaders, Authorization: `Bearer ${auth.apiKey}` };
  }
  return { ...auth, headers: mergedHeaders };
}

function configuredApiKey(
  config: ModelsJsonProvider | undefined,
  extension: ProviderConfigInput | undefined,
): string | undefined {
  return extension?.apiKey ?? config?.apiKey;
}

function configuredHeaders(
  config: ModelsJsonProvider | undefined,
  extension: ProviderConfigInput | undefined,
): Record<string, string> | undefined {
  if (config?.headers === undefined && extension?.headers === undefined) return undefined;
  return { ...config?.headers, ...extension?.headers };
}

function configContextEnv(
  values: readonly string[],
  ctx: AuthContext,
  explicit?: Record<string, string>,
): Effect.Effect<Record<string, string> | undefined> {
  return awaiting(function* () {
    const env = { ...explicit };
    for (const name of new Set(values.flatMap(getConfigValueEnvVarNames))) {
      if (env[name] !== undefined) continue;
      const value = yield* awaited(ctx.env(name));
      if (value !== undefined) env[name] = value;
    }
    return Object.keys(env).length > 0 ? env : undefined;
  });
}

function composeApiKeyAuth(
  providerId: string,
  base: Provider | undefined,
  config: ModelsJsonProvider | undefined,
  extension: ProviderConfigInput | undefined,
): ApiKeyAuth | undefined {
  const inherited = base?.auth.apiKey;
  const rawKey = configuredApiKey(config, extension);
  const oauth = extension?.oauth ?? base?.auth.oauth;
  if (inherited === undefined && rawKey === undefined && oauth !== undefined) return undefined;
  const rawHeaders = configuredHeaders(config, extension);
  const authHeader = extension?.authHeader ?? config?.authHeader ?? false;
  return {
    name: inherited?.name ?? "API key",
    login:
      inherited?.login ??
      ((interaction: AuthInteraction) =>
        Effect.runPromise(
          awaiting(function* () {
            return {
              type: "api_key",
              key: yield* awaited(interaction.prompt({ type: "secret", message: "Enter API key" })),
            };
          }),
        )),
    check: (input) =>
      Effect.runPromise(
        awaiting(function* () {
          if (input.credential !== undefined) {
            if (inherited?.check !== undefined) return yield* awaited(inherited.check(input));
            if (input.credential.key !== undefined && input.credential.key !== "")
              return { type: "api_key", source: "stored credential" };
            const resolved = yield* awaited(inherited?.resolve(input));
            return resolved === undefined
              ? undefined
              : { type: "api_key", source: resolved.source };
          }
          if (rawKey !== undefined) {
            if (isCommandConfigValue(rawKey))
              return { type: "api_key", source: "configured API key" };
            const envNames = getConfigValueEnvVarNames(rawKey);
            for (const name of envNames) {
              if ((yield* awaited(input.ctx.env(name))) === undefined) return undefined;
            }
            return { type: "api_key", source: "configured API key" };
          }
          if (inherited?.check !== undefined) return yield* awaited(inherited.check(input));
          const resolved = yield* awaited(inherited?.resolve(input));
          return resolved === undefined ? undefined : { type: "api_key", source: resolved.source };
        }),
      ),
    resolve: (input) =>
      Effect.runPromise(
        awaiting(function* () {
          let result: AuthResult | undefined;
          if (input.credential !== undefined) {
            result =
              inherited === undefined
                ? input.credential.key !== undefined && input.credential.key !== ""
                  ? {
                      auth: { apiKey: input.credential.key },
                      env: input.credential.env,
                      source: "stored credential",
                    }
                  : undefined
                : yield* awaited(inherited.resolve(input));
          } else if (rawKey === undefined) {
            result = yield* awaited(inherited?.resolve(input));
          } else {
            const env = yield* performed(configContextEnv([rawKey], input.ctx));
            const key = resolveConfigValueOrThrow(
              rawKey,
              `API key for provider "${providerId}"`,
              env,
            );
            result =
              inherited === undefined
                ? { auth: { apiKey: key }, source: "configured API key" }
                : yield* awaited(
                    inherited.resolve({ ...input, credential: { type: "api_key", key } }),
                  );
          }
          if (result === undefined) return undefined;
          const explicitEnv = { ...(input.credential?.env ?? {}), ...(result.env ?? {}) };
          const headerEnv = yield* performed(
            configContextEnv(Object.values(rawHeaders ?? {}), input.ctx, explicitEnv),
          );
          const headers = resolveHeadersOrThrow(rawHeaders, `provider "${providerId}"`, headerEnv);
          return { ...result, auth: withConfiguredAuth(result.auth, headers, authHeader) };
        }),
      ),
  };
}

function composeOAuthAuth(
  providerId: string,
  base: Provider | undefined,
  config: ModelsJsonProvider | undefined,
  extension: ProviderConfigInput | undefined,
): OAuthAuth | undefined {
  const oauth = extension?.oauth === undefined ? base?.auth.oauth : adaptOAuth(extension.oauth);
  if (oauth === undefined) return undefined;
  const rawHeaders = configuredHeaders(config, extension);
  const authHeader = extension?.authHeader ?? config?.authHeader ?? false;
  return {
    ...oauth,
    toAuth: (credential) =>
      Effect.runPromise(
        awaiting(function* () {
          const auth = yield* awaited(oauth.toAuth(credential));
          const env = credential["env"];
          const headers = resolveHeadersOrThrow(
            rawHeaders,
            `provider "${providerId}"`,
            typeof env === "object" && env !== null ? (env as Record<string, string>) : undefined,
          );
          return withConfiguredAuth(auth, headers, authHeader);
        }),
      ),
  };
}

function rawModelHeaders(
  model: AnyModel,
  config: ModelsJsonProvider | undefined,
  extension: ProviderConfigInput | undefined,
): Record<string, string> | undefined {
  const chatDefinition = isModelType(model, "chat")
    ? config?.models?.find((entry) => entry.id === model.id)
    : undefined;
  const extensionModel = extension?.models?.find(
    (entry) => (entry.type ?? "chat") === (model.type ?? "chat") && entry.id === model.id,
  );
  const headers = {
    ...(isModelType(model, "chat") ? config?.modelOverrides?.[model.id]?.headers : undefined),
    ...chatDefinition?.headers,
    ...extensionModel?.headers,
  };
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function validateExtensionProvider(
  providerId: string,
  base: Provider | undefined,
  modelsConfig: ModelsJsonProvider | undefined,
  extension: ProviderConfigInput,
): void {
  if (extension.streamSimple !== undefined && extension.api === undefined) {
    throw new Error(`Provider ${providerId}: "api" is required when registering streamSimple.`);
  }
  applyExtension(
    providerId,
    applyModelsJson(providerId, getAllProviderModels(base), modelsConfig),
    extension,
  );
}

export function composeModelProvider(
  providerId: string,
  base: Provider | undefined,
  modelConfig: ModelConfig,
  extension: ProviderConfigInput | undefined,
): Provider {
  const config = modelConfig.getProvider(providerId);
  let extensionOAuthCredential: OAuthCredentials | undefined;
  let refreshedExtensionModels: ProviderConfigInput["models"];
  const currentExtension = (): ProviderConfigInput | undefined =>
    extension !== undefined && refreshedExtensionModels !== undefined
      ? { ...extension, models: refreshedExtensionModels }
      : extension;
  const getAllModels = (): AnyModel[] => {
    let models = applyExtension(
      providerId,
      applyModelsJson(providerId, getAllProviderModels(base), config),
      currentExtension(),
    );
    if (extensionOAuthCredential !== undefined && extension?.oauth?.modifyModels !== undefined) {
      models = [
        ...extension.oauth.modifyModels(
          models.filter((model) => isModelType(model, "chat")),
          extensionOAuthCredential,
        ),
        ...models.filter((model) => !isModelType(model, "chat")),
      ];
    }
    return models.map((model) => {
      const override = config?.modelOverrides?.[model.id];
      return override !== undefined && isModelType(model, "chat")
        ? applyModelOverride(model, override)
        : model;
    });
  };
  getAllModels();
  const apiKey = composeApiKeyAuth(providerId, base, config, extension);
  const oauth = composeOAuthAuth(providerId, base, config, extension);
  if (apiKey === undefined && oauth === undefined)
    throw new Error(`Provider ${providerId}: no authentication method configured.`);

  const supportsBaseApi = (model: Model<Api>) =>
    base?.getModels().some((entry) => entry.api === model.api) ?? false;
  const streamWith = (
    model: Model<Api>,
    context: TranscriptContext,
    options: StreamOptions | undefined,
    simple: boolean,
  ): AssistantMessageEventStream =>
    lazyStream(model, () =>
      Effect.runPromise(
        Effect.sync(() => {
          if (extension?.streamSimple !== undefined && model.api === extension.api) {
            return extension.streamSimple(model, context, options as SimpleStreamOptions);
          }
          if (base !== undefined && supportsBaseApi(model)) {
            return simple
              ? base.streamSimple(model, context, options as SimpleStreamOptions)
              : base.stream(model, context, options);
          }
          const api = getApiProvider(model.api);
          if (api === undefined)
            throw new Error(`No API provider registered for api: ${model.api}`);
          return simple
            ? api.streamSimple(model, context, options as SimpleStreamOptions)
            : api.stream(model, context, options);
        }),
      ),
    );

  const provider: Provider = {
    id: providerId,
    name: extension?.name ?? config?.name ?? base?.name ?? extension?.oauth?.name ?? providerId,
    baseUrl: extension?.baseUrl ?? config?.baseUrl ?? base?.baseUrl,
    headers: base?.headers,
    auth: {
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(oauth === undefined ? {} : { oauth }),
    },
    getModels: () => getAllModels().filter((model) => isModelType(model, "chat")),
    getAllModels,
    ...(base?.refreshModels !== undefined ||
    extension?.refreshModels !== undefined ||
    extension?.oauth?.modifyModels !== undefined
      ? {
          refreshModels: (context: RefreshModelsContext) =>
            Effect.runPromise(
              awaiting(function* () {
                yield* awaited(base?.refreshModels?.(context));
                let refreshed: NonNullable<ProviderConfigInput["models"]> | undefined;
                if (extension?.refreshModels !== undefined)
                  refreshed = yield* awaited(extension.refreshModels(context));
                if (context.signal.aborted) return;
                const oauthCredential =
                  context.credential?.type === "oauth" ? context.credential : undefined;
                yield* awaited(
                  context.publish({
                    update: () => {
                      if (refreshed !== undefined) {
                        applyExtension(
                          providerId,
                          applyModelsJson(providerId, getAllProviderModels(base), config),
                          {
                            ...extension,
                            models: refreshed,
                          },
                        );
                        refreshedExtensionModels = refreshed;
                      }
                      extensionOAuthCredential = oauthCredential;
                    },
                  }),
                );
              }),
            ),
        }
      : {}),
    ...(base?.filterModels === undefined
      ? {}
      : {
          filterModels: (models: readonly Model<Api>[], credential: Credential | undefined) =>
            base.filterModels!(models, credential),
        }),
    ...(base?.filterAllModels === undefined
      ? {}
      : {
          filterAllModels: (models: readonly AnyModel[], credential: Credential | undefined) =>
            base.filterAllModels!(models, credential),
        }),
    stream: (model, context, options) => streamWith(model, context, options, false),
    streamSimple: (model, context, options) => streamWith(model, context, options, true),
  };

  const fetchDeferred = base?.fetchDeferred;
  if (fetchDeferred !== undefined) {
    provider.fetchDeferred = (model, handle, options) => fetchDeferred(model, handle, options);
  }
  const cancelDeferred = base?.cancelDeferred;
  if (cancelDeferred !== undefined) {
    provider.cancelDeferred = (model, handle, options) => cancelDeferred(model, handle, options);
  }
  const extensionImages = extension?.images;
  const generateImages = base?.generateImages;
  if (generateImages !== undefined || Object.keys(extensionImages ?? {}).length > 0) {
    provider.generateImages = (model, context, options) => {
      const implementation = extensionImages?.[model.api];
      if (implementation !== undefined)
        return implementation.generateImages(model, context, options);
      if (generateImages !== undefined) return generateImages(model, context, options);
      return Promise.resolve(
        imageErrorResult(
          model,
          new Error(`Provider ${providerId} has no image implementation for "${model.api}"`),
        ),
      );
    };
  }
  const extensionClassifiers = extension?.classifiers;
  const classify = base?.classify;
  if (classify !== undefined || Object.keys(extensionClassifiers ?? {}).length > 0) {
    provider.classify = (model, context, options) => {
      const implementation = extensionClassifiers?.[model.api];
      if (implementation !== undefined) return implementation.classify(model, context, options);
      if (classify !== undefined) return classify(model, context, options);
      return Promise.resolve(
        classifierErrorResult(
          model,
          new Error(`Provider ${providerId} has no classifier implementation for "${model.api}"`),
        ),
      );
    };
  }

  return provider;
}

export function resolveConfiguredModelHeaders(
  model: AnyModel,
  config: ModelsJsonProvider | undefined,
  extension: ProviderConfigInput | undefined,
  env?: Record<string, string>,
): Record<string, string> | undefined {
  return resolveHeadersOrThrow(
    rawModelHeaders(model, config, extension),
    `model "${model.provider}/${model.id}"`,
    env,
  );
}

export interface CompatibilityRequestConfig {
  headers?: ProviderHeaders | undefined;
  authHeader: boolean;
}

export function resolveCompatibilityRequestConfig(
  model: AnyModel,
  config: ModelsJsonProvider | undefined,
  extension: ProviderConfigInput | undefined,
): CompatibilityRequestConfig {
  const configured = resolveHeadersOrThrow(
    { ...configuredHeaders(config, extension), ...rawModelHeaders(model, config, extension) },
    `model "${model.provider}/${model.id}"`,
  );
  return {
    headers:
      model.headers !== undefined || configured !== undefined
        ? { ...model.headers, ...configured }
        : undefined,
    authHeader: extension?.authHeader ?? config?.authHeader ?? false,
  };
}

export function configuredRequestAuthStatus(
  config: ModelsJsonProvider | undefined,
  extension: ProviderConfigInput | undefined,
): AuthStatus | undefined {
  const value = configuredApiKey(config, extension);
  if (value === undefined) return undefined;
  if (isCommandConfigValue(value)) return { configured: true, source: "models_json_command" };
  const names = getConfigValueEnvVarNames(value);
  if (names.length > 0) {
    return isConfigValueConfigured(value)
      ? { configured: true, source: "environment", label: names.join(", ") }
      : { configured: false };
  }
  return {
    configured: true,
    source: extension?.apiKey === undefined ? "models_json_key" : "fallback",
  };
}
