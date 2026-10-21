import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type modelConfigTypes from "../model-config.types.ts";
import type providerComposerTypes from "../provider-composer.types.ts";
import resolveConfigValueModule from "../resolve-config-value.ts";

const { awaited, awaiting } = awaitingModule;
const { getConfigValueEnvVarNames, clearConfigValueCache } = resolveConfigValueModule;

const clearApiKeyCache = clearConfigValueCache;

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

const providerAuth = {
  clearApiKeyCache,
  configContextEnv,
  configuredApiKey,
  configuredHeaders,
  withConfiguredAuth,
};

export default providerAuth;
