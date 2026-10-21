import { Effect, Fiber } from "effect";

import sessionResources from "../session-resources.ts";
import clock from "../utils/clock.ts";
import type openaiCodexWsCacheTypes from "./openai-codex-ws-cache.types.ts";
import type openaiCodexWsConstructorTypes from "./openai-codex-ws-constructor.types.ts";
import openaiCodexWsSocket from "./openai-codex-ws-socket.ts";

const { closeWebSocket, connectWebSocket, isWebSocketReusable } = openaiCodexWsSocket;
const { registerSessionResourceCleanup } = sessionResources;
const { currentTimeMillis } = clock;

const SESSION_WEBSOCKET_CACHE_TTL_MS = 5 * 60 * 1000;
const SESSION_WEBSOCKET_MAX_AGE_MS = 55 * 60 * 1000;

interface CacheSlot {
  readonly sessionId: string;
  readonly accountId: string;
}

const websocketSessionCache = new Map<
  string,
  Map<string, openaiCodexWsCacheTypes.CachedWebSocketConnection>
>();

function clearIdleTimer(entry: openaiCodexWsCacheTypes.CachedWebSocketConnection): void {
  if (entry.idleTimer === undefined) return;
  Effect.runFork(Fiber.interrupt(entry.idleTimer));
  entry.idleTimer = undefined;
}

function removeEntry(
  { sessionId, accountId }: CacheSlot,
  entry: openaiCodexWsCacheTypes.CachedWebSocketConnection,
): void {
  const entries = websocketSessionCache.get(sessionId);
  if (entries?.get(accountId) === entry) entries.delete(accountId);
  if (entries?.size === 0) websocketSessionCache.delete(sessionId);
}

function scheduleExpiry(
  slot: CacheSlot,
  entry: openaiCodexWsCacheTypes.CachedWebSocketConnection,
): void {
  clearIdleTimer(entry);
  entry.idleTimer = Effect.runFork(
    Effect.sleep(SESSION_WEBSOCKET_CACHE_TTL_MS).pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (entry.busy) return;
          closeWebSocket("idle_timeout")(entry.socket);
          removeEntry(slot, entry);
        }),
      ),
    ),
  );
}

function closeOpenAICodexWebSocketSessions(sessionId?: string): void {
  const closeEntries = (
    entries: Map<string, openaiCodexWsCacheTypes.CachedWebSocketConnection> | undefined,
  ) => {
    for (const entry of entries?.values() ?? []) {
      clearIdleTimer(entry);
      closeWebSocket("debug_close")(entry.socket);
    }
  };
  if (sessionId !== undefined && sessionId !== "") {
    closeEntries(websocketSessionCache.get(sessionId));
    websocketSessionCache.delete(sessionId);
    return;
  }
  for (const entries of websocketSessionCache.values()) closeEntries(entries);
  websocketSessionCache.clear();
}

registerSessionResourceCleanup(closeOpenAICodexWebSocketSessions);

const oneShotLease = (
  socket: openaiCodexWsConstructorTypes.WebSocketLike,
): openaiCodexWsCacheTypes.SocketLease => ({
  release: () => closeWebSocket()(socket),
  reused: false,
  socket,
});

function cachedLease(
  slot: CacheSlot,
  entry: openaiCodexWsCacheTypes.CachedWebSocketConnection,
  reused: boolean,
) {
  return {
    entry,
    release: ({ keep }: { keep?: boolean } = {}) => {
      if (keep !== true || !isWebSocketReusable(entry.socket)) {
        closeWebSocket()(entry.socket);
        clearIdleTimer(entry);
        removeEntry(slot, entry);
        return;
      }
      entry.busy = false;
      scheduleExpiry(slot, entry);
    },
    reused,
    socket: entry.socket,
  } satisfies openaiCodexWsCacheTypes.SocketLease;
}

function reuseCached(
  slot: CacheSlot,
  cached: openaiCodexWsCacheTypes.CachedWebSocketConnection,
): openaiCodexWsCacheTypes.SocketLease | "busy" | undefined {
  clearIdleTimer(cached);
  if (cached.busy) return "busy";
  if (currentTimeMillis() - cached.createdAt >= SESSION_WEBSOCKET_MAX_AGE_MS) {
    closeWebSocket("connection_age_limit")(cached.socket);
    removeEntry(slot, cached);
    return undefined;
  }
  if (isWebSocketReusable(cached.socket)) {
    cached.busy = true;
    return cachedLease(slot, cached, true);
  }
  closeWebSocket()(cached.socket);
  removeEntry(slot, cached);
  return undefined;
}

function cacheNew(
  slot: CacheSlot,
  socket: openaiCodexWsConstructorTypes.WebSocketLike,
): openaiCodexWsCacheTypes.SocketLease {
  const entry: openaiCodexWsCacheTypes.CachedWebSocketConnection = {
    busy: true,
    createdAt: currentTimeMillis(),
    socket,
  };
  const entries = websocketSessionCache.get(slot.sessionId) ?? new Map();
  websocketSessionCache.set(slot.sessionId, entries);
  entries.set(slot.accountId, entry);
  return cachedLease(slot, entry, false);
}

const acquireWebSocket = Effect.fn("acquireWebSocket")(function* (
  request: openaiCodexWsCacheTypes.WebSocketAcquireRequest,
) {
  const { sessionId, accountId } = request;
  if (sessionId === undefined || sessionId === "") {
    return oneShotLease(yield* connectWebSocket(request));
  }
  const slot = { accountId, sessionId };
  const cached = websocketSessionCache.get(sessionId)?.get(accountId);
  const reused = cached === undefined ? undefined : reuseCached(slot, cached);
  if (reused === "busy") return oneShotLease(yield* connectWebSocket(request));
  if (reused !== undefined) return reused;
  return cacheNew(slot, yield* connectWebSocket(request));
});

const openaiCodexWsCache = {
  acquireWebSocket,
  closeOpenAICodexWebSocketSessions,
};

export default openaiCodexWsCache;
