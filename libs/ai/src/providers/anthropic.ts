import { Effect } from "effect";

import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { promptUser, throwIfAborted } from "../auth/helpers.ts";
import type {
  ApiKeyAuth,
  ApiKeyCredential,
  AuthContext,
  ProviderAuthInteraction,
} from "../auth/types.ts";
import {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_AUTH_TOKEN_ENV,
  ANTHROPIC_FEDERATION_RULE_ID_ENV,
  ANTHROPIC_IDENTITY_TOKEN_FILE_ENV,
  ANTHROPIC_ORGANIZATION_ID_ENV,
  ANTHROPIC_SERVICE_ACCOUNT_ID_ENV,
  ANTHROPIC_WORKSPACE_ID_ENV,
} from "../env-api-keys.ts";
import { createProvider, type Provider } from "../models.ts";
import type { ProviderEnv } from "../types.ts";
import { ANTHROPIC_API_MODELS } from "./anthropic-api.models.ts";

const isPresent = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

const loginAnthropicApiKey = Effect.fn("loginAnthropicApiKey")(function* (
  interaction: ProviderAuthInteraction,
) {
  yield* throwIfAborted(interaction.signal);
  const key = yield* promptUser(interaction, {
    type: "secret",
    message: "Enter Anthropic API key",
  });
  yield* throwIfAborted(interaction.signal);
  return { type: "api_key", key } satisfies ApiKeyCredential;
});

const REQUIRED_FEDERATION_ENV = [
  ANTHROPIC_FEDERATION_RULE_ID_ENV,
  ANTHROPIC_ORGANIZATION_ID_ENV,
  ANTHROPIC_IDENTITY_TOKEN_FILE_ENV,
];

const OPTIONAL_FEDERATION_ENV = [ANTHROPIC_SERVICE_ACCOUNT_ID_ENV, ANTHROPIC_WORKSPACE_ID_ENV];

const resolveFederationEnv = Effect.fn("resolveFederationEnv")(function* (
  env: (name: string) => Effect.Effect<string | undefined>,
) {
  const federation: ProviderEnv = {};
  for (const envVar of REQUIRED_FEDERATION_ENV) {
    const value = yield* env(envVar);
    if (!isPresent(value)) return undefined;
    federation[envVar] = value;
  }
  for (const envVar of OPTIONAL_FEDERATION_ENV) {
    const value = yield* env(envVar);
    if (isPresent(value)) federation[envVar] = value;
  }
  return federation;
});

const resolveAnthropicApiKey = Effect.fn("resolveAnthropicApiKey")(function* ({
  ctx,
  credential,
  signal,
}: {
  ctx: AuthContext;
  credential?: ApiKeyCredential | undefined;
  signal: AbortSignal;
}) {
  yield* throwIfAborted(signal);
  if (isPresent(credential?.key)) {
    return {
      auth: { apiKey: credential.key },
      env: credential.env,
      source: "stored credential",
    };
  }
  const env = (name: string) =>
    Effect.promise(() => ctx.env(name)).pipe(Effect.tap(throwIfAborted(signal)));

  const authToken = yield* env(ANTHROPIC_AUTH_TOKEN_ENV);
  if (isPresent(authToken)) {
    return {
      auth: { headers: { Authorization: `Bearer ${authToken}` } },
      source: ANTHROPIC_AUTH_TOKEN_ENV,
    };
  }

  const apiKey = yield* env(ANTHROPIC_API_KEY_ENV);
  if (isPresent(apiKey)) return { auth: { apiKey }, source: ANTHROPIC_API_KEY_ENV };

  const federation = yield* resolveFederationEnv(env);
  if (federation === undefined) return undefined;
  return { auth: {}, env: federation, source: "workload identity federation" };
});

function anthropicApiKeyAuth(): ApiKeyAuth {
  return {
    name: "Anthropic API key",
    login: (interaction) => Effect.runPromise(loginAnthropicApiKey(interaction)),
    resolve: (input) => Effect.runPromise(resolveAnthropicApiKey(input)),
  };
}

export function anthropicProvider(): Provider<"anthropic-messages"> {
  return createProvider({
    id: "anthropic-api",
    name: "Anthropic API",
    baseUrl: "https://api.anthropic.com",
    auth: {
      apiKey: anthropicApiKeyAuth(),
    },
    models: Object.values(ANTHROPIC_API_MODELS),
    api: anthropicMessagesApi(),
  });
}
