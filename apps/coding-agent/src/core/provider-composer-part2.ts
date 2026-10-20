import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "./awaiting.ts";
import type modelConfigTypes from "./model-config.types.ts";
import providerComposerPart1 from "./provider-composer-part1.ts";
import type providerComposerTypes from "./provider-composer.types.ts";
import resolveConfigValueModule from "./resolve-config-value.ts";

const { awaited, awaiting, performed } = awaitingModule;
const {
  getConfigValueEnvVarNames,
  isCommandConfigValue,
  resolveConfigValueOrThrow,
  resolveHeadersOrThrow,
} = resolveConfigValueModule;
const { isModelType } = ai;
const { applyModelsJson, extensionModelFromDefinition, getAllProviderModels } =
  providerComposerPart1;

function applyExtension(
  providerId: string,
  models: readonly aiTypes.AnyModel[],
  config: providerComposerTypes.ProviderConfigInput | undefined,
): aiTypes.AnyModel[] {
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

function adaptOAuth(config: providerComposerTypes.ExtensionOAuthConfig): aiTypes.OAuthAuth {
  return {
    isSubscription: config.isSubscription,
    login: (callbacks) =>
      Effect.runPromise(
        awaiting(function* () {
          const credential = yield* awaited(
            config.login({
              onAuth: (info) => callbacks.notify({ type: "auth_url", ...info }),
              onDeviceCode: (info) => callbacks.notify({ type: "device_code", ...info }),
              onManualCodeInput: () =>
                callbacks.prompt({ message: "Paste the authorization code", type: "manual_code" }),
              onProgress: (message) => callbacks.notify({ message, type: "progress" }),
              onPrompt: (prompt) => callbacks.prompt({ type: "text", ...prompt }),
              onSelect: (prompt) => callbacks.prompt({ type: "select", ...prompt }),
              signal: callbacks.signal,
            }),
          );
          return { ...credential, type: "oauth" };
        }),
      ),
    name: config.name,
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
  auth: aiTypes.ModelAuth,
  headers: Record<string, string> | undefined,
  authHeader: boolean,
): aiTypes.ModelAuth {
  let mergedHeaders: aiTypes.ProviderHeaders | undefined =
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
  config: modelConfigTypes.ModelsJsonProvider | undefined,
  extension: providerComposerTypes.ProviderConfigInput | undefined,
): string | undefined {
  return extension?.apiKey ?? config?.apiKey;
}

function configuredHeaders(
  config: modelConfigTypes.ModelsJsonProvider | undefined,
  extension: providerComposerTypes.ProviderConfigInput | undefined,
): Record<string, string> | undefined {
  if (config?.headers === undefined && extension?.headers === undefined) return undefined;
  return { ...config?.headers, ...extension?.headers };
}

function configContextEnv(
  values: readonly string[],
  ctx: aiTypes.AuthContext,
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
  base: aiTypes.Provider | undefined,
  config: modelConfigTypes.ModelsJsonProvider | undefined,
  extension: providerComposerTypes.ProviderConfigInput | undefined,
): aiTypes.ApiKeyAuth | undefined {
  const inherited = base?.auth.apiKey;
  const rawKey = configuredApiKey(config, extension);
  const oauth = extension?.oauth ?? base?.auth.oauth;
  if (inherited === undefined && rawKey === undefined && oauth !== undefined) return undefined;
  const rawHeaders = configuredHeaders(config, extension);
  const authHeader = extension?.authHeader ?? config?.authHeader ?? false;
  return {
    check: (input) =>
      Effect.runPromise(
        awaiting(function* () {
          if (input.credential !== undefined) {
            if (inherited?.check !== undefined) return yield* awaited(inherited.check(input));
            if (input.credential.key !== undefined && input.credential.key !== "")
              return { source: "stored credential", type: "api_key" };
            const resolved = yield* awaited(inherited?.resolve(input));
            return resolved === undefined
              ? undefined
              : { source: resolved.source, type: "api_key" };
          }
          if (rawKey !== undefined) {
            if (isCommandConfigValue(rawKey))
              return { source: "configured API key", type: "api_key" };
            const envNames = getConfigValueEnvVarNames(rawKey);
            for (const name of envNames) {
              if ((yield* awaited(input.ctx.env(name))) === undefined) return undefined;
            }
            return { source: "configured API key", type: "api_key" };
          }
          if (inherited?.check !== undefined) return yield* awaited(inherited.check(input));
          const resolved = yield* awaited(inherited?.resolve(input));
          return resolved === undefined ? undefined : { source: resolved.source, type: "api_key" };
        }),
      ),
    login:
      inherited?.login ??
      ((interaction: aiTypes.AuthInteraction) =>
        Effect.runPromise(
          awaiting(function* () {
            return {
              key: yield* awaited(interaction.prompt({ message: "Enter API key", type: "secret" })),
              type: "api_key",
            };
          }),
        )),
    name: inherited?.name ?? "API key",
    resolve: (input) =>
      Effect.runPromise(
        awaiting(function* () {
          let result: aiTypes.AuthResult | undefined;
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
            const key = composeApiKeyAuthPart1(rawKey, providerId, env);
            result =
              inherited === undefined
                ? { auth: { apiKey: key }, source: "configured API key" }
                : yield* awaited(
                    inherited.resolve({ ...input, credential: { key, type: "api_key" } }),
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

function composeApiKeyAuthPart1(
  rawKey: string,
  providerId: string,
  env: Record<string, string> | undefined,
) {
  return resolveConfigValueOrThrow(rawKey, `API key for provider "${providerId}"`, env);
}

function composeOAuthAuth(
  providerId: string,
  base: aiTypes.Provider | undefined,
  config: modelConfigTypes.ModelsJsonProvider | undefined,
  extension: providerComposerTypes.ProviderConfigInput | undefined,
): aiTypes.OAuthAuth | undefined {
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
  model: aiTypes.AnyModel,
  config: modelConfigTypes.ModelsJsonProvider | undefined,
  extension: providerComposerTypes.ProviderConfigInput | undefined,
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

function validateExtensionProvider(
  providerId: string,
  base: aiTypes.Provider | undefined,
  modelsConfig: modelConfigTypes.ModelsJsonProvider | undefined,
  extension: providerComposerTypes.ProviderConfigInput,
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

const providerComposerPart2 = {
  applyExtension,
  composeApiKeyAuth,
  composeOAuthAuth,
  configuredApiKey,
  configuredHeaders,
  rawModelHeaders,
  validateExtensionProvider,
};

export default providerComposerPart2;
