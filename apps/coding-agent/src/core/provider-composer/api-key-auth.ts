import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type modelConfigTypes from "../model-config.types.ts";
import type providerComposerTypes from "../provider-composer.types.ts";
import resolveConfigValueModule from "../resolve-config-value.ts";
import oauthAuth from "./oauth-auth.ts";
import providerAuth from "./provider-auth.ts";

const {
  resolveConfigValueOrThrow,
  resolveHeadersOrThrow,
  getConfigValueEnvVarNames,
  isCommandConfigValue,
} = resolveConfigValueModule;
const { performed, awaited, awaiting } = awaitingModule;
const { composeOAuthAuth } = oauthAuth;
const { withConfiguredAuth, configContextEnv, configuredHeaders, configuredApiKey } = providerAuth;

type ApiKeySetup = {
  providerId: string;
  inherited: aiTypes.ApiKeyAuth | undefined;
  rawKey: string | undefined;
  rawHeaders: Record<string, string> | undefined;
  authHeader: boolean;
};

type CheckInput = Parameters<NonNullable<aiTypes.ApiKeyAuth["check"]>>[0];

type ResolveInput = Parameters<aiTypes.ApiKeyAuth["resolve"]>[0];

function* checkInherited(setup: ApiKeySetup, input: CheckInput) {
  const { inherited } = setup;
  if (inherited?.check !== undefined) return yield* awaited(inherited.check(input));
  const resolved = yield* awaited(inherited?.resolve(input));
  return resolved === undefined
    ? undefined
    : ({ source: resolved.source, type: "api_key" } as const);
}

function* checkApiKey(setup: ApiKeySetup, input: CheckInput) {
  const { rawKey } = setup;
  if (input.credential !== undefined) {
    if (setup.inherited?.check === undefined && input.credential.key !== undefined) {
      if (input.credential.key !== "")
        return { source: "stored credential", type: "api_key" } as const;
    }
    return yield* checkInherited(setup, input);
  }
  if (rawKey === undefined) return yield* checkInherited(setup, input);
  if (!isCommandConfigValue(rawKey)) {
    for (const name of getConfigValueEnvVarNames(rawKey)) {
      if ((yield* awaited(input.ctx.env(name))) === undefined) return undefined;
    }
  }
  return { source: "configured API key", type: "api_key" } as const;
}

function* baseAuthResult(setup: ApiKeySetup, input: ResolveInput) {
  const { inherited, rawKey, providerId } = setup;
  if (input.credential !== undefined) {
    if (inherited !== undefined) return yield* awaited(inherited.resolve(input));
    const { key, env } = input.credential;
    return key !== undefined && key !== ""
      ? { auth: { apiKey: key }, env, source: "stored credential" }
      : undefined;
  }
  if (rawKey === undefined) return yield* awaited(inherited?.resolve(input));
  const env = yield* performed(configContextEnv([rawKey], input.ctx));
  const key = resolveConfigValueOrThrow(rawKey, `API key for provider "${providerId}"`, env);
  return inherited === undefined
    ? { auth: { apiKey: key }, source: "configured API key" }
    : yield* awaited(inherited.resolve({ ...input, credential: { key, type: "api_key" } }));
}

function* resolveApiKeyAuth(setup: ApiKeySetup, input: ResolveInput) {
  const result: aiTypes.AuthResult | undefined = yield* baseAuthResult(setup, input);
  if (result === undefined) return undefined;
  const explicitEnv = { ...(input.credential?.env ?? {}), ...(result.env ?? {}) };
  const headerEnv = yield* performed(
    configContextEnv(Object.values(setup.rawHeaders ?? {}), input.ctx, explicitEnv),
  );
  const headers = resolveHeadersOrThrow(
    setup.rawHeaders,
    `provider "${setup.providerId}"`,
    headerEnv,
  );
  return { ...result, auth: withConfiguredAuth(result.auth, headers, setup.authHeader) };
}

const promptApiKey = (interaction: aiTypes.AuthInteraction) =>
  Effect.runPromise(
    awaiting(function* () {
      return {
        key: yield* awaited(interaction.prompt({ message: "Enter API key", type: "secret" })),
        type: "api_key",
      } as const;
    }),
  );

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
  const setup: ApiKeySetup = {
    authHeader: extension?.authHeader ?? config?.authHeader ?? false,
    inherited,
    providerId,
    rawHeaders: configuredHeaders(config, extension),
    rawKey,
  };
  return {
    check: (input) => Effect.runPromise(awaiting(() => checkApiKey(setup, input))),
    login: inherited?.login ?? promptApiKey,
    name: inherited?.name ?? "API key",
    resolve: (input) => Effect.runPromise(awaiting(() => resolveApiKeyAuth(setup, input))),
  };
}

const composeAuth = (
  providerId: string,
  base: aiTypes.Provider | undefined,
  config: modelConfigTypes.ModelsJsonProvider | undefined,
  extension: providerComposerTypes.ProviderConfigInput | undefined,
): { apiKey: aiTypes.ApiKeyAuth | undefined; oauth: aiTypes.OAuthAuth | undefined } => ({
  apiKey: composeApiKeyAuth(providerId, base, config, extension),
  oauth: composeOAuthAuth(providerId, base, config, extension),
});

const apiKeyAuth = { composeApiKeyAuth, composeAuth };

export default apiKeyAuth;
