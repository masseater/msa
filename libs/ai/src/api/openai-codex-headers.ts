import type { ProviderHeaders } from "../types.ts";
import { getMsaUserAgent } from "../utils/user-agent.ts";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";
const OPENAI_BETA_RESPONSES_WEBSOCKETS = "responses_websockets=2026-02-06";

export function resolveCodexUrl(baseUrl: string | undefined): string {
  const raw = baseUrl !== undefined && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
  const normalized = raw.replace(/\/+$/u, "");
  if (normalized.endsWith("/codex/responses")) return normalized;
  if (normalized.endsWith("/codex")) return `${normalized}/responses`;
  return `${normalized}/codex/responses`;
}

export function resolveCodexWebSocketUrl(baseUrl: string | undefined): string {
  const url = new URL(resolveCodexUrl(baseUrl));
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol === "http:") url.protocol = "ws:";
  return url.toString();
}

export function extractAccountId(token: string): string {
  try {
    const parts = token.split(".");
    const payloadPart = parts[1];
    if (parts.length !== 3 || payloadPart === undefined) throw new Error("Invalid token");
    const payload = JSON.parse(atob(payloadPart)) as Record<
      string,
      { chatgpt_account_id?: unknown } | undefined
    > | null;
    const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
    if (typeof accountId !== "string" || accountId === "") throw new Error("No account ID");
    return accountId;
  } catch {
    throw new Error("Failed to extract accountId from token");
  }
}

export interface CodexCredentials {
  readonly modelHeaders: Record<string, string> | undefined;
  readonly optionHeaders: ProviderHeaders | undefined;
  readonly accountId: string;
  readonly token: string;
}

function baseCodexHeaders({ modelHeaders, optionHeaders, accountId, token }: CodexCredentials) {
  const headers = new Headers({ originator: "pi", "User-Agent": getMsaUserAgent() });
  for (const [key, value] of Object.entries(modelHeaders ?? {})) headers.set(key, value);
  for (const [key, value] of Object.entries(optionHeaders ?? {})) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("chatgpt-account-id", accountId);
  return headers;
}

export function buildSSEHeaders(
  credentials: CodexCredentials,
): (sessionId: string | undefined) => Headers {
  return (sessionId) => {
    const headers = baseCodexHeaders(credentials);
    headers.set("OpenAI-Beta", "responses=experimental");
    headers.set("accept", "text/event-stream");
    headers.set("content-type", "application/json");
    if (sessionId !== undefined && sessionId !== "") {
      headers.set("session-id", sessionId);
      headers.set("x-client-request-id", sessionId);
    }
    return headers;
  };
}

export function buildWebSocketHeaders(
  credentials: CodexCredentials,
): (requestId: string) => Headers {
  return (requestId) => {
    const headers = baseCodexHeaders(credentials);
    headers.delete("accept");
    headers.delete("content-type");
    headers.delete("OpenAI-Beta");
    headers.delete("openai-beta");
    headers.set("OpenAI-Beta", OPENAI_BETA_RESPONSES_WEBSOCKETS);
    headers.set("x-client-request-id", requestId);
    headers.set("session-id", requestId);
    return headers;
  };
}
