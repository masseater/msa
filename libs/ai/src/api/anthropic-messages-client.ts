import Anthropic from "@anthropic-ai/sdk";

import envApiKeys from "../env-api-keys.ts";
import type typesModule from "../types.types.ts";
import providerEnv from "../utils/provider-env.ts";
import userAgent from "../utils/user-agent.ts";
import type anthropicMessagesClientTypes from "./anthropic-messages-client.types.ts";
import anthropicMessagesCompat from "./anthropic-messages-compat.ts";

const { getMsaUserAgent } = userAgent;
const { getProviderEnvValue } = providerEnv;
const {
  ANTHROPIC_FEDERATION_RULE_ID_ENV,
  ANTHROPIC_IDENTITY_TOKEN_FILE_ENV,
  ANTHROPIC_ORGANIZATION_ID_ENV,
  ANTHROPIC_SERVICE_ACCOUNT_ID_ENV,
  ANTHROPIC_WORKSPACE_ID_ENV,
} = envApiKeys;
const { getAnthropicCompat } = anthropicMessagesCompat;

function mergeHeaders(
  ...headerSources: (typesModule.ProviderHeaders | undefined)[]
): typesModule.ProviderHeaders {
  const merged: typesModule.ProviderHeaders = {};
  for (const headers of headerSources) {
    if (headers !== undefined) {
      Object.assign(merged, headers);
    }
  }
  return merged;
}

function mergeClientHeaders(
  ...headerSources: (typesModule.ProviderHeaders | undefined)[]
): typesModule.ProviderHeaders {
  return mergeHeaders({ "User-Agent": getMsaUserAgent() }, ...headerSources);
}

function hasHeader(headers: typesModule.ProviderHeaders | undefined, name: string): boolean {
  if (headers === undefined) return false;
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected && value !== null && value.trim().length > 0) return true;
  }
  return false;
}

function hasRequestAuth(
  apiKey: string | undefined,
  headers: typesModule.ProviderHeaders | undefined,
): boolean {
  return (
    (apiKey !== undefined && apiKey !== "") ||
    hasHeader(headers, "authorization") ||
    hasHeader(headers, "x-api-key") ||
    hasHeader(headers, "cf-aig-authorization")
  );
}
function assertRequestAuth(input: anthropicMessagesClientTypes.AssertRequestAuthInput): void {
  const { provider, apiKey, headers } = input;
  if (!hasRequestAuth(apiKey, headers)) throw new Error(`No API key for provider: ${provider}`);
}

class MsaAnthropic extends Anthropic {
  protected override _shouldResolveDefaultCredentials(): boolean {
    return false;
  }
}

function readFederationSetting(
  name: string,
  env: typesModule.ProviderEnv | undefined,
): string | undefined {
  const value = getProviderEnvValue(name, env);
  return value === undefined || value === "" ? undefined : value;
}
function getAnthropicFederation(
  input: anthropicMessagesClientTypes.AnthropicFederationInput,
): anthropicMessagesClientTypes.AnthropicFederationConfig | undefined {
  const { model, apiKey, headers, env } = input;
  if (model.provider !== "anthropic-api" || hasRequestAuth(apiKey, headers)) return undefined;
  const federationRuleId = readFederationSetting(ANTHROPIC_FEDERATION_RULE_ID_ENV, env);
  const organizationId = readFederationSetting(ANTHROPIC_ORGANIZATION_ID_ENV, env);
  const identityTokenFile = readFederationSetting(ANTHROPIC_IDENTITY_TOKEN_FILE_ENV, env);
  if (
    federationRuleId === undefined ||
    organizationId === undefined ||
    identityTokenFile === undefined
  )
    return undefined;
  return {
    authentication: {
      federation_rule_id: federationRuleId,
      identity_token: { path: identityTokenFile, source: "file" },
      service_account_id: getProviderEnvValue(ANTHROPIC_SERVICE_ACCOUNT_ID_ENV, env),
      type: "oidc_federation",
    },
    organization_id: organizationId,
    workspace_id: getProviderEnvValue(ANTHROPIC_WORKSPACE_ID_ENV, env),
  };
}

let federationClient:
  | { key: string; fetch: typeof globalThis.fetch | undefined; client: Anthropic }
  | undefined;

function buildSessionAffinityHeaders(
  model: typesModule.Model<"anthropic-messages">,
  sessionId: string | undefined,
): typesModule.ProviderHeaders {
  const headers: typesModule.ProviderHeaders = {};
  const compat = getAnthropicCompat(model);
  if (sessionId === undefined || sessionId === "" || !compat.sendSessionAffinityHeaders) {
    return headers;
  }
  const header =
    compat.sessionAffinityFormat === "openrouter" ? "x-session-id" : "x-session-affinity";
  headers[header] = sessionId;
  return headers;
}

function createFederatedClient(
  model: typesModule.Model<"anthropic-messages">,
  fetch: typeof globalThis.fetch | undefined,
  federation: anthropicMessagesClientTypes.AnthropicFederationConfig,
  defaultHeaders: typesModule.ProviderHeaders,
): Anthropic {
  const key = JSON.stringify([model.baseUrl, federation]);
  if (federationClient?.key !== key || federationClient.fetch !== fetch) {
    const client = new MsaAnthropic({
      apiKey: null,
      authToken: null,
      baseURL: model.baseUrl,
      config: federation,
      dangerouslyAllowBrowser: true,
      fetch,
    });
    federationClient = { client, fetch, key };
  }
  return federationClient.client.withOptions({ defaultHeaders });
}

function createApiKeyClient(
  input: anthropicMessagesClientTypes.CreateClientInput,
  defaultHeaders: typesModule.ProviderHeaders,
): Anthropic {
  return new MsaAnthropic({
    apiKey: input.apiKey ?? null,
    authToken: null,
    baseURL: input.model.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders,
    fetch: input.fetch,
  });
}

function createClient(input: anthropicMessagesClientTypes.CreateClientInput): Anthropic {
  const sessionAffinityHeaders = buildSessionAffinityHeaders(input.model, input.sessionId);
  const defaultHeaders = mergeClientHeaders(
    {
      accept: "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    sessionAffinityHeaders,
    input.model.headers,
    input.optionsHeaders,
  );
  if (input.federation !== undefined) {
    return createFederatedClient(input.model, input.fetch, input.federation, defaultHeaders);
  }
  return createApiKeyClient(input, defaultHeaders);
}

const anthropicMessagesClient = {
  assertRequestAuth,
  createClient,
  getAnthropicFederation,
};

export default anthropicMessagesClient;
