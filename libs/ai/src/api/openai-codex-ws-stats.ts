import { formatThrownValue } from "../utils/diagnostics.ts";
import type { CodexRequestBody } from "./openai-codex-options.ts";

export interface OpenAICodexWebSocketDebugStats {
  requests: number;
  connectionsCreated: number;
  connectionsReused: number;
  cachedContextRequests: number;
  storeTrueRequests: number;
  fullContextRequests: number;
  deltaRequests: number;
  lastInputItems: number;
  lastDeltaInputItems?: number | undefined;
  lastPreviousResponseId?: string | undefined;
  websocketFailures: number;
  sseFallbacks: number;
  websocketFallbackActive?: boolean;
  lastWebSocketError?: string;
}

const websocketDebugStats = new Map<string, OpenAICodexWebSocketDebugStats>();
const websocketSseFallbackSessions = new Set<string>();

const hasSession = (sessionId: string | undefined): sessionId is string =>
  sessionId !== undefined && sessionId !== "";

function statsFor(sessionId: string): OpenAICodexWebSocketDebugStats {
  const existing = websocketDebugStats.get(sessionId);
  if (existing !== undefined) return existing;
  const stats: OpenAICodexWebSocketDebugStats = {
    requests: 0,
    connectionsCreated: 0,
    connectionsReused: 0,
    cachedContextRequests: 0,
    storeTrueRequests: 0,
    fullContextRequests: 0,
    deltaRequests: 0,
    lastInputItems: 0,
    websocketFailures: 0,
    sseFallbacks: 0,
  };
  websocketDebugStats.set(sessionId, stats);
  return stats;
}

export function getOpenAICodexWebSocketDebugStats(
  sessionId: string,
): OpenAICodexWebSocketDebugStats | undefined {
  const stats = websocketDebugStats.get(sessionId);
  return stats === undefined ? undefined : { ...stats };
}

export function resetOpenAICodexWebSocketDebugStats(sessionId?: string): void {
  if (hasSession(sessionId)) {
    websocketDebugStats.delete(sessionId);
    websocketSseFallbackSessions.delete(sessionId);
    return;
  }
  websocketDebugStats.clear();
  websocketSseFallbackSessions.clear();
}

export function isWebSocketSseFallbackActive(sessionId: string | undefined): boolean {
  return hasSession(sessionId) && websocketSseFallbackSessions.has(sessionId);
}

export function recordWebSocketSseFallback(sessionId: string | undefined): void {
  if (!hasSession(sessionId)) return;
  const stats = statsFor(sessionId);
  stats.sseFallbacks++;
  stats.websocketFallbackActive = isWebSocketSseFallbackActive(sessionId);
}

export function recordWebSocketFailure(sessionId: string | undefined): (error: unknown) => void {
  return (error) => {
    if (!hasSession(sessionId)) return;
    websocketSseFallbackSessions.add(sessionId);
    const stats = statsFor(sessionId);
    stats.websocketFailures++;
    stats.lastWebSocketError = formatThrownValue(error);
    stats.websocketFallbackActive = true;
  };
}

export interface WebSocketRequestRecord {
  readonly sessionId: string | undefined;
  readonly requestBody: CodexRequestBody;
  readonly reused: boolean;
  readonly useCachedContext: boolean;
}

export function recordWebSocketRequestStats({
  sessionId,
  requestBody,
  reused,
  useCachedContext,
}: WebSocketRequestRecord): void {
  if (!hasSession(sessionId)) return;
  const stats = statsFor(sessionId);
  stats.requests++;
  if (reused) stats.connectionsReused++;
  else stats.connectionsCreated++;
  if (useCachedContext) stats.cachedContextRequests++;
  if (requestBody.store === true) stats.storeTrueRequests++;
  const inputItems = requestBody.input?.length ?? 0;
  stats.lastInputItems = inputItems;
  const previousResponseId = requestBody.previous_response_id;
  const delta = previousResponseId !== undefined && previousResponseId !== "";
  if (delta) stats.deltaRequests++;
  else stats.fullContextRequests++;
  stats.lastDeltaInputItems = delta ? inputItems : undefined;
  stats.lastPreviousResponseId = delta ? previousResponseId : undefined;
}
