import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";

import {
  ANTHROPIC_FEDERATION_RULE_ID_ENV,
  ANTHROPIC_IDENTITY_TOKEN_FILE_ENV,
  ANTHROPIC_ORGANIZATION_ID_ENV,
  ANTHROPIC_SERVICE_ACCOUNT_ID_ENV,
  ANTHROPIC_WORKSPACE_ID_ENV,
} from "../env-api-keys.ts";
import type { Model, ProviderEnv, ProviderHeaders } from "../types.ts";
import { getProviderEnvValue } from "../utils/provider-env.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";
import { getAnthropicCompat } from "./anthropic-messages-compat.ts";
import { claudeCodeVersion } from "./anthropic-messages-content.ts";

function mergeHeaders(...headerSources: (ProviderHeaders | undefined)[]): ProviderHeaders {
  const merged: ProviderHeaders = {};
  for (const headers of headerSources) {
    if (headers !== undefined) {
      Object.assign(merged, headers);
    }
  }
  return merged;
}

function mergeClientHeaders(...headerSources: (ProviderHeaders | undefined)[]): ProviderHeaders {
  return mergeHeaders({ "User-Agent": getMsaUserAgent() }, ...headerSources);
}

function hasHeader(headers: ProviderHeaders | undefined, name: string): boolean {
  if (headers === undefined) return false;
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected && value !== null && value.trim().length > 0) return true;
  }
  return false;
}

function hasRequestAuth(apiKey: string | undefined, headers: ProviderHeaders | undefined): boolean {
  return (
    (apiKey !== undefined && apiKey !== "") ||
    hasHeader(headers, "authorization") ||
    hasHeader(headers, "x-api-key") ||
    hasHeader(headers, "cf-aig-authorization")
  );
}

interface AssertRequestAuthInput {
  readonly provider: string;
  readonly apiKey: string | undefined;
  readonly headers: ProviderHeaders | undefined;
}

function assertRequestAuth(input: AssertRequestAuthInput): void {
  const { provider, apiKey, headers } = input;
  if (!hasRequestAuth(apiKey, headers)) throw new Error(`No API key for provider: ${provider}`);
}

class MsaAnthropic extends Anthropic {
  protected override _shouldResolveDefaultCredentials(): boolean {
    return false;
  }
}

type AnthropicFederationConfig = NonNullable<ClientOptions["config"]>;

function readFederationSetting(name: string, env: ProviderEnv | undefined): string | undefined {
  const value = getProviderEnvValue(name, env);
  return value === undefined || value === "" ? undefined : value;
}

interface AnthropicFederationInput {
  readonly model: Model<"anthropic-messages">;
  readonly apiKey: string | undefined;
  readonly headers: ProviderHeaders | undefined;
  readonly env: ProviderEnv | undefined;
}

function getAnthropicFederation(
  input: AnthropicFederationInput,
): AnthropicFederationConfig | undefined {
  const { model, apiKey, headers, env } = input;
  if (model.provider !== "anthropic" || hasRequestAuth(apiKey, headers)) return undefined;
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
    organization_id: organizationId,
    workspace_id: getProviderEnvValue(ANTHROPIC_WORKSPACE_ID_ENV, env),
    authentication: {
      type: "oidc_federation",
      federation_rule_id: federationRuleId,
      service_account_id: getProviderEnvValue(ANTHROPIC_SERVICE_ACCOUNT_ID_ENV, env),
      identity_token: { source: "file", path: identityTokenFile },
    },
  };
}

let federationClient:
  | { key: string; fetch: typeof globalThis.fetch | undefined; client: Anthropic }
  | undefined;

function isOAuthToken(apiKey: string): boolean {
  return apiKey.includes("sk-ant-oat");
}

interface CreateClientInput {
  model: Model<"anthropic-messages">;
  apiKey: string | undefined;
  optionsHeaders?: ProviderHeaders | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  sessionId?: string | undefined;
  federation?: AnthropicFederationConfig | undefined;
}

function createOAuthClient(input: CreateClientInput): Anthropic {
  const { model, apiKey, optionsHeaders, fetch } = input;
  return new MsaAnthropic({
    apiKey: null,
    authToken: apiKey ?? null,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    fetch,
    defaultHeaders: mergeClientHeaders(
      {
        accept: "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
        "user-agent": `claude-cli/${claudeCodeVersion}`,
        "x-app": "cli",
      },
      model.headers,
      optionsHeaders,
    ),
  });
}

function buildSessionAffinityHeaders(
  model: Model<"anthropic-messages">,
  sessionId: string | undefined,
): ProviderHeaders {
  const headers: ProviderHeaders = {};
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
  model: Model<"anthropic-messages">,
  fetch: typeof globalThis.fetch | undefined,
  federation: AnthropicFederationConfig,
  defaultHeaders: ProviderHeaders,
): Anthropic {
  const key = JSON.stringify([model.baseUrl, federation]);
  if (federationClient?.key !== key || federationClient.fetch !== fetch) {
    const client = new MsaAnthropic({
      apiKey: null,
      authToken: null,
      config: federation,
      baseURL: model.baseUrl,
      dangerouslyAllowBrowser: true,
      fetch,
    });
    federationClient = { key, fetch, client };
  }
  return federationClient.client.withOptions({ defaultHeaders });
}

function createApiKeyClient(input: CreateClientInput, defaultHeaders: ProviderHeaders): Anthropic {
  return new MsaAnthropic({
    apiKey: input.apiKey ?? null,
    authToken: null,
    baseURL: input.model.baseUrl,
    dangerouslyAllowBrowser: true,
    fetch: input.fetch,
    defaultHeaders,
  });
}

function createClient(input: CreateClientInput): {
  client: Anthropic;
  isOAuthToken: boolean;
} {
  const { apiKey } = input;
  if (apiKey !== undefined && apiKey !== "" && isOAuthToken(apiKey)) {
    return { client: createOAuthClient(input), isOAuthToken: true };
  }

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
    return {
      client: createFederatedClient(input.model, input.fetch, input.federation, defaultHeaders),
      isOAuthToken: false,
    };
  }
  return { client: createApiKeyClient(input, defaultHeaders), isOAuthToken: false };
}

export {
  assertRequestAuth,
  createClient,
  getAnthropicFederation,
  type AnthropicFederationConfig,
  type CreateClientInput,
};
