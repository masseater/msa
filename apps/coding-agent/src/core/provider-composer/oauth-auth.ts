import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import awaitingModule from "../awaiting.ts";
import type modelConfigTypes from "../model-config.types.ts";
import type providerComposerTypes from "../provider-composer.types.ts";
import resolveConfigValueModule from "../resolve-config-value.ts";
import providerAuth from "./provider-auth.ts";

const { resolveHeadersOrThrow } = resolveConfigValueModule;
const { awaited, awaiting } = awaitingModule;
const { withConfiguredAuth, configuredHeaders } = providerAuth;

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

const oauthAuth = { composeOAuthAuth };

export default oauthAuth;
