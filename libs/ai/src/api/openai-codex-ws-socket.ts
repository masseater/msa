import { Data, Effect } from "effect";

import type { ProviderEnv } from "../types.ts";
import { headersToRecord } from "../utils/headers.ts";
import { requestAbortedError } from "./openai-codex-error.ts";
import {
  getWebSocketConstructor,
  type WebSocketConstructor,
  type WebSocketLike,
  type WebSocketListener,
} from "./openai-codex-ws-constructor.ts";

const DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS = 15_000;
const WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE = 1009;

class WebSocketCloseError extends Data.TaggedError("WebSocketCloseError")<{
  readonly message: string;
  readonly code: number | undefined;
  readonly reason: string | undefined;
  readonly wasClean: boolean | undefined;
}> {}

const field = (event: object, key: string): unknown =>
  key in event ? (event as Record<string, unknown>)[key] : undefined;

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export function extractWebSocketError(event: unknown): Error {
  if (typeof event !== "object" || event === null) return new Error("WebSocket error");
  const message = field(event, "message");
  if (nonEmpty(message)) return new Error(message);
  const nested = field(event, "error");
  if (nested instanceof Error && nested.message.length > 0) return nested;
  const nestedMessage =
    typeof nested === "object" && nested !== null ? field(nested, "message") : undefined;
  return new Error(nonEmpty(nestedMessage) ? nestedMessage : "WebSocket error");
}

export function extractWebSocketCloseError(event: unknown): Error {
  if (typeof event !== "object" || event === null) return new Error("WebSocket closed");
  const code = field(event, "code");
  const reason = field(event, "reason");
  const wasClean = field(event, "wasClean");
  const codeText = typeof code === "number" ? ` ${code}` : "";
  const tooBig = code === WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE ? " message too big" : "";
  const reasonText = nonEmpty(reason) ? ` ${reason}` : tooBig;
  return new WebSocketCloseError({
    message: `WebSocket closed${codeText}${reasonText}`.trim(),
    code: typeof code === "number" ? code : undefined,
    reason: nonEmpty(reason) ? reason : undefined,
    wasClean: typeof wasClean === "boolean" ? wasClean : undefined,
  });
}

export function closeWebSocket(reason = "done"): (socket: WebSocketLike) => void {
  return (socket) => {
    try {
      socket.close(1000, reason);
    } catch {}
  };
}

export function isWebSocketReusable(socket: WebSocketLike): boolean {
  const readyState = (socket as { readyState?: unknown }).readyState;
  return typeof readyState !== "number" || readyState === 1;
}

interface OpenWatch {
  readonly socket: WebSocketLike;
  readonly signal: AbortSignal | undefined;
  readonly resume: (effect: Effect.Effect<WebSocketLike>) => void;
}

function watchOpen({ socket, signal, resume }: OpenWatch): Effect.Effect<void> {
  let settled = false;
  const onOpen: WebSocketListener = () => settle(Effect.succeed(socket));
  const onError: WebSocketListener = (event) => settle(Effect.die(extractWebSocketError(event)));
  const onClose: WebSocketListener = (event) =>
    settle(Effect.die(extractWebSocketCloseError(event)));
  const onAbort = () => settle(Effect.die(requestAbortedError()), "aborted");
  const cleanup = () => {
    socket.removeEventListener("open", onOpen);
    socket.removeEventListener("error", onError);
    socket.removeEventListener("close", onClose);
    signal?.removeEventListener("abort", onAbort);
  };
  function settle(result: Effect.Effect<WebSocketLike>, closeReason?: string): void {
    if (settled) return;
    settled = true;
    cleanup();
    if (closeReason !== undefined) closeWebSocket(closeReason)(socket);
    resume(result);
  }
  socket.addEventListener("open", onOpen);
  socket.addEventListener("error", onError);
  socket.addEventListener("close", onClose);
  signal?.addEventListener("abort", onAbort);
  if (signal?.aborted === true) onAbort();
  return Effect.sync(() => {
    if (settled) return;
    settled = true;
    cleanup();
    closeWebSocket("connect_timeout")(socket);
  });
}

export interface WebSocketConnectRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly signal: AbortSignal | undefined;
  readonly connectTimeoutMs: number | undefined;
  readonly env: ProviderEnv | undefined;
}

function openSocket(
  WebSocketCtor: WebSocketConstructor,
  { url, headers, signal }: WebSocketConnectRequest,
): Effect.Effect<WebSocketLike> {
  const wsHeaders = headersToRecord(headers);
  delete wsHeaders["OpenAI-Beta"];
  return Effect.callback<WebSocketLike>((resume) => {
    try {
      const socket = new WebSocketCtor(url, { headers: wsHeaders });
      return watchOpen({ socket, signal, resume });
    } catch (error) {
      resume(Effect.die(error instanceof Error ? error : new Error(String(error))));
      return undefined;
    }
  });
}

export function connectWebSocket(request: WebSocketConnectRequest): Effect.Effect<WebSocketLike> {
  return Effect.suspend(() => {
    const WebSocketCtor = getWebSocketConstructor(request.env);
    if (WebSocketCtor === null) {
      return Effect.die(new Error("WebSocket transport is not available in this runtime"));
    }
    const connect = openSocket(WebSocketCtor, request);
    const timeoutMs = request.connectTimeoutMs ?? DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS;
    if (timeoutMs <= 0) return connect;
    return connect.pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () => Effect.die(new Error(`WebSocket connect timeout after ${timeoutMs}ms`)),
      }),
    );
  });
}
