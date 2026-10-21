import diagnosticsModule from "../utils/diagnostics.ts";
import type openaiCodexWsStatsTypes from "./openai-codex-ws-stats.types.ts";

const { formatThrownValue } = diagnosticsModule;

const websocketDebugStats = new Map<
  string,
  openaiCodexWsStatsTypes.OpenAICodexWebSocketDebugStats
>();
const websocketSseFallbackSessions = new Set<string>();

const hasSession = (sessionId: string | undefined): sessionId is string =>
  sessionId !== undefined && sessionId !== "";

function statsFor(sessionId: string): openaiCodexWsStatsTypes.OpenAICodexWebSocketDebugStats {
  const existing = websocketDebugStats.get(sessionId);
  if (existing !== undefined) return existing;
  const stats: openaiCodexWsStatsTypes.OpenAICodexWebSocketDebugStats = {
    cachedContextRequests: 0,
    connectionsCreated: 0,
    connectionsReused: 0,
    deltaRequests: 0,
    fullContextRequests: 0,
    lastInputItems: 0,
    requests: 0,
    sseFallbacks: 0,
    storeTrueRequests: 0,
    websocketFailures: 0,
  };
  websocketDebugStats.set(sessionId, stats);
  return stats;
}

function getOpenAICodexWebSocketDebugStats(
  sessionId: string,
): openaiCodexWsStatsTypes.OpenAICodexWebSocketDebugStats | undefined {
  const stats = websocketDebugStats.get(sessionId);
  return stats === undefined ? undefined : { ...stats };
}

function resetOpenAICodexWebSocketDebugStats(sessionId?: string): void {
  if (hasSession(sessionId)) {
    websocketDebugStats.delete(sessionId);
    websocketSseFallbackSessions.delete(sessionId);
    return;
  }
  websocketDebugStats.clear();
  websocketSseFallbackSessions.clear();
}

function isWebSocketSseFallbackActive(sessionId: string | undefined): boolean {
  return hasSession(sessionId) && websocketSseFallbackSessions.has(sessionId);
}

function recordWebSocketSseFallback(sessionId: string | undefined): void {
  if (!hasSession(sessionId)) return;
  const stats = statsFor(sessionId);
  stats.sseFallbacks++;
  stats.websocketFallbackActive = isWebSocketSseFallbackActive(sessionId);
}

function recordWebSocketFailure(sessionId: string | undefined): (error: unknown) => void {
  return (error) => {
    if (!hasSession(sessionId)) return;
    websocketSseFallbackSessions.add(sessionId);
    const stats = statsFor(sessionId);
    stats.websocketFailures++;
    stats.lastWebSocketError = formatThrownValue(error);
    stats.websocketFallbackActive = true;
  };
}

function recordWebSocketRequestStats({
  sessionId,
  requestBody,
  reused,
  useCachedContext,
}: openaiCodexWsStatsTypes.WebSocketRequestRecord): void {
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

const openaiCodexWsStats = {
  getOpenAICodexWebSocketDebugStats,
  isWebSocketSseFallbackActive,
  recordWebSocketFailure,
  recordWebSocketRequestStats,
  recordWebSocketSseFallback,
  resetOpenAICodexWebSocketDebugStats,
};

export default openaiCodexWsStats;
