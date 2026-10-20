import { Effect } from "effect";

import anthropicMessagesLazy from "../api/anthropic-messages.lazy.ts";
import helpers from "../auth/helpers.ts";
import type typesModule from "../auth/types.ts";
import envApiKeys from "../env-api-keys.ts";
import modelsModule from "../models.ts";
import type modelsTypes from "../models.types.ts";
import type typesModuleModule from "../types.types.ts";
import anthropicApiModels from "./anthropic-api.models.ts";

const { promptUser, throwIfAborted } = helpers;
const {
  ANTHROPIC_API_KEY_ENV,
  ANTHROPIC_AUTH_TOKEN_ENV,
  ANTHROPIC_FEDERATION_RULE_ID_ENV,
  ANTHROPIC_IDENTITY_TOKEN_FILE_ENV,
  ANTHROPIC_ORGANIZATION_ID_ENV,
  ANTHROPIC_SERVICE_ACCOUNT_ID_ENV,
  ANTHROPIC_WORKSPACE_ID_ENV,
} = envApiKeys;
const { createProvider } = modelsModule;
const { anthropicMessagesApi } = anthropicMessagesLazy;
const { ANTHROPIC_API_MODELS } = anthropicApiModels;

const isPresent = (value: string | undefined): value is string =>
  value !== undefined && value !== "";

const loginAnthropicApiKey = Effect.fn("loginAnthropicApiKey")(function* (
  interaction: typesModule.ProviderAuthInteraction,
) {
  yield* throwIfAborted(interaction.signal);
  const key = yield* promptUser(interaction, {
    message: "Enter Anthropic API key",
    type: "secret",
  });
  yield* throwIfAborted(interaction.signal);
  return { key, type: "api_key" } satisfies typesModule.ApiKeyCredential;
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
  const federation: typesModuleModule.ProviderEnv = {};
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
  ctx: typesModule.AuthContext;
  credential?: typesModule.ApiKeyCredential | undefined;
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

function anthropicApiKeyAuth(): typesModule.ApiKeyAuth {
  return {
    login: (interaction) => Effect.runPromise(loginAnthropicApiKey(interaction)),
    name: "Anthropic API key",
    resolve: (input) => Effect.runPromise(resolveAnthropicApiKey(input)),
  };
}

function anthropicProvider(): modelsTypes.Provider<"anthropic-messages"> {
  return createProvider({
    api: anthropicMessagesApi(),
    auth: {
      apiKey: anthropicApiKeyAuth(),
    },
    baseUrl: "https://api.anthropic.com",
    id: "anthropic-api",
    models: Object.values(ANTHROPIC_API_MODELS),
    name: "Anthropic API",
  });
}

const anthropic = {
  anthropicProvider,
};

export default anthropic;
