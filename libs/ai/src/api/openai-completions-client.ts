import OpenAI from "openai";

import type { Model, ProviderHeaders } from "../types.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";
import type { ResolvedOpenAICompletionsCompat } from "./openai-completions-types.ts";

function hasHeader(headers: ProviderHeaders | undefined, name: string): boolean {
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
  headers: ProviderHeaders | undefined;
}): string {
  const { provider, apiKey, headers } = input;
  if (apiKey !== undefined && apiKey !== "") return apiKey;
  if (hasHeader(headers, "authorization") || hasHeader(headers, "cf-aig-authorization"))
    return "unused";
  throw new Error(`No API key for provider: ${provider}`);
}

function applySessionAffinity(
  headers: ProviderHeaders,
  sessionId: string | undefined,
  compat: ResolvedOpenAICompletionsCompat,
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
  readonly model: Model<"openai-completions">;
  readonly apiKey: string;
  readonly optionsHeaders: ProviderHeaders | undefined;
  readonly fetch: typeof globalThis.fetch | undefined;
  readonly sessionId: string | undefined;
  readonly compat: ResolvedOpenAICompletionsCompat;
}

function createClient(input: CreateClientInput): OpenAI {
  const { model, apiKey, optionsHeaders, fetch, sessionId, compat } = input;
  const headers: ProviderHeaders = { "User-Agent": getMsaUserAgent(), ...model.headers };
  applySessionAffinity(headers, sessionId, compat);
  if (optionsHeaders !== undefined) {
    Object.assign(headers, optionsHeaders);
  }
  return new OpenAI({
    apiKey,
    baseURL: model.baseUrl,
    dangerouslyAllowBrowser: true,
    fetch,
    defaultHeaders: headers,
  });
}

export { createClient, getClientApiKey };
