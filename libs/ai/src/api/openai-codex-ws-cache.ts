import { Effect, Fiber } from "effect";
import type { ResponseInput } from "openai/resources/responses/responses.js";

import { registerSessionResourceCleanup } from "../session-resources.ts";
import { currentTimeMillis } from "../utils/clock.ts";
import type { CodexRequestBody } from "./openai-codex-options.ts";
import type { WebSocketLike } from "./openai-codex-ws-constructor.ts";
import {
  closeWebSocket,
  connectWebSocket,
  isWebSocketReusable,
  type WebSocketConnectRequest,
} from "./openai-codex-ws-socket.ts";

const SESSION_WEBSOCKET_CACHE_TTL_MS = 5 * 60 * 1000;
const SESSION_WEBSOCKET_MAX_AGE_MS = 55 * 60 * 1000;

export interface CachedWebSocketContinuationState {
  lastRequestBody: CodexRequestBody;
  lastResponseId: string;
  lastResponseItems: ResponseInput;
}

export interface CachedWebSocketConnection {
  socket: WebSocketLike;
  busy: boolean;
  createdAt: number;
  idleTimer?: Fiber.Fiber<void> | undefined;
  continuation?: CachedWebSocketContinuationState | undefined;
}

export interface SocketLease {
  readonly socket: WebSocketLike;
  readonly entry?: CachedWebSocketConnection;
  readonly reused: boolean;
  readonly release: (options?: { keep?: boolean }) => void;
}

interface CacheSlot {
  readonly sessionId: string;
  readonly accountId: string;
}

const websocketSessionCache = new Map<string, Map<string, CachedWebSocketConnection>>();

function clearIdleTimer(entry: CachedWebSocketConnection): void {
  if (entry.idleTimer === undefined) return;
  Effect.runFork(Fiber.interrupt(entry.idleTimer));
  entry.idleTimer = undefined;
}

function removeEntry({ sessionId, accountId }: CacheSlot, entry: CachedWebSocketConnection): void {
  const entries = websocketSessionCache.get(sessionId);
  if (entries?.get(accountId) === entry) entries.delete(accountId);
  if (entries?.size === 0) websocketSessionCache.delete(sessionId);
}

function scheduleExpiry(slot: CacheSlot, entry: CachedWebSocketConnection): void {
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

export function closeOpenAICodexWebSocketSessions(sessionId?: string): void {
  const closeEntries = (entries: Map<string, CachedWebSocketConnection> | undefined) => {
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

const oneShotLease = (socket: WebSocketLike): SocketLease => ({
  socket,
  reused: false,
  release: () => closeWebSocket()(socket),
});

function cachedLease(slot: CacheSlot, entry: CachedWebSocketConnection, reused: boolean) {
  return {
    socket: entry.socket,
    entry,
    reused,
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
  } satisfies SocketLease;
}

function reuseCached(
  slot: CacheSlot,
  cached: CachedWebSocketConnection,
): SocketLease | "busy" | undefined {
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

function cacheNew(slot: CacheSlot, socket: WebSocketLike): SocketLease {
  const entry: CachedWebSocketConnection = { socket, busy: true, createdAt: currentTimeMillis() };
  const entries = websocketSessionCache.get(slot.sessionId) ?? new Map();
  websocketSessionCache.set(slot.sessionId, entries);
  entries.set(slot.accountId, entry);
  return cachedLease(slot, entry, false);
}

export interface WebSocketAcquireRequest extends WebSocketConnectRequest {
  readonly sessionId: string | undefined;
  readonly accountId: string;
}

export const acquireWebSocket = Effect.fn("acquireWebSocket")(function* (
  request: WebSocketAcquireRequest,
) {
  const { sessionId, accountId } = request;
  if (sessionId === undefined || sessionId === "") {
    return oneShotLease(yield* connectWebSocket(request));
  }
  const slot = { sessionId, accountId };
  const cached = websocketSessionCache.get(sessionId)?.get(accountId);
  const reused = cached === undefined ? undefined : reuseCached(slot, cached);
  if (reused === "busy") return oneShotLease(yield* connectWebSocket(request));
  if (reused !== undefined) return reused;
  return cacheNew(slot, yield* connectWebSocket(request));
});
