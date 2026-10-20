import OpenAI from "openai";

import type typesModule from "../types.types.ts";
import userAgent from "../utils/user-agent.ts";
import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";

const { getMsaUserAgent } = userAgent;

function hasHeader(headers: typesModule.ProviderHeaders | undefined, name: string): boolean {
  if (headers === undefined) return false;
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected && value !== null && value.trim().length > 0) return true;
  }
  return false;
}

function getClientApiKey(input: {
  provider: string;
  apiKey: string | undefined;
  headers: typesModule.ProviderHeaders | undefined;
}): string {
  const { provider, apiKey, headers } = input;
  if (apiKey !== undefined && apiKey !== "") return apiKey;
  if (hasHeader(headers, "authorization") || hasHeader(headers, "cf-aig-authorization"))
    return "unused";
  throw new Error(`No API key for provider: ${provider}`);
}

function applySessionAffinity(
  headers: typesModule.ProviderHeaders,
  sessionId: string | undefined,
  compat: openaiCompletionsTypesModule.ResolvedOpenAICompletionsCompat,
): void {
  if (sessionId === undefined || sessionId === "" || !compat.sendSessionAffinityHeaders) return;
  if (compat.sessionAffinityFormat === "openrouter") {
    headers["x-session-id"] = sessionId;
    return;
  }
  if (compat.sessionAffinityFormat === "openai") {
    headers["session_id"] = sessionId;
  }
  headers["x-client-request-id"] = sessionId;
  headers["x-session-affinity"] = sessionId;
}

interface CreateClientInput {
  readonly model: typesModule.Model<"openai-completions">;
  readonly apiKey: string;
  readonly optionsHeaders: typesModule.ProviderHeaders | undefined;
  readonly fetch: typeof globalThis.fetch | undefined;
  readonly sessionId: string | undefined;
  readonly compat: openaiCompletionsTypesModule.ResolvedOpenAICompletionsCompat;
}

function createClient(input: CreateClientInput): OpenAI {
  const { model, apiKey, optionsHeaders, fetch, sessionId, compat } = input;
  const headers: typesModule.ProviderHeaders = {
    "User-Agent": getMsaUserAgent(),
    ...model.headers,
  };
  applySessionAffinity(headers, sessionId, compat);
  if (optionsHeaders !== undefined) {
    Object.assign(headers, optionsHeaders);
  }
  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    defaultHeaders: headers,
    fetch,
  });
}

const openaiCompletionsClient = {
  createClient,
  getClientApiKey,
};

export default openaiCompletionsClient;
