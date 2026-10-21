import { Data, Effect } from "effect";

import headersModule from "../utils/headers.ts";
import openaiCodexError from "./openai-codex-error.ts";
import openaiCodexWsConstructor from "./openai-codex-ws-constructor.ts";
import type openaiCodexWsConstructorTypes from "./openai-codex-ws-constructor.types.ts";
import type openaiCodexWsSocketTypes from "./openai-codex-ws-socket.types.ts";

const { requestAbortedError } = openaiCodexError;
const { headersToRecord } = headersModule;
const { getWebSocketConstructor } = openaiCodexWsConstructor;

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

function extractWebSocketError(event: unknown): Error {
  if (typeof event !== "object" || event === null) return new Error("WebSocket error");
  const message = field(event, "message");
  if (nonEmpty(message)) return new Error(message);
  const nested = field(event, "error");
  if (nested instanceof Error && nested.message.length > 0) return nested;
  const nestedMessage =
    typeof nested === "object" && nested !== null ? field(nested, "message") : undefined;
  return new Error(nonEmpty(nestedMessage) ? nestedMessage : "WebSocket error");
}

function extractWebSocketCloseError(event: unknown): Error {
  if (typeof event !== "object" || event === null) return new Error("WebSocket closed");
  const code = field(event, "code");
  const reason = field(event, "reason");
  const wasClean = field(event, "wasClean");
  const codeText = typeof code === "number" ? ` ${code}` : "";
  const tooBig = code === WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE ? " message too big" : "";
  const reasonText = nonEmpty(reason) ? ` ${reason}` : tooBig;
  return new WebSocketCloseError({
    code: typeof code === "number" ? code : undefined,
    message: `WebSocket closed${codeText}${reasonText}`.trim(),
    reason: nonEmpty(reason) ? reason : undefined,
    wasClean: typeof wasClean === "boolean" ? wasClean : undefined,
  });
}

function closeWebSocket(
  reason = "done",
): (socket: openaiCodexWsConstructorTypes.WebSocketLike) => void {
  return (socket) => {
    try {
      socket.close(1000, reason);
    } catch {}
  };
}

function isWebSocketReusable(socket: openaiCodexWsConstructorTypes.WebSocketLike): boolean {
  const readyState = (socket as { readyState?: unknown }).readyState;
  return typeof readyState !== "number" || readyState === 1;
}

interface OpenWatch {
  readonly socket: openaiCodexWsConstructorTypes.WebSocketLike;
  readonly signal: AbortSignal | undefined;
  readonly resume: (effect: Effect.Effect<openaiCodexWsConstructorTypes.WebSocketLike>) => void;
}

function watchOpen({ socket, signal, resume }: OpenWatch): Effect.Effect<void> {
  let settled = false;
  const onOpen: openaiCodexWsConstructorTypes.WebSocketListener = () =>
    settle(Effect.succeed(socket));
  const onError: openaiCodexWsConstructorTypes.WebSocketListener = (event) =>
    settle(Effect.die(extractWebSocketError(event)));
  const onClose: openaiCodexWsConstructorTypes.WebSocketListener = (event) =>
    settle(Effect.die(extractWebSocketCloseError(event)));
  const onAbort = () => settle(Effect.die(requestAbortedError()), "aborted");
  const cleanup = () => {
    socket.removeEventListener("open", onOpen);
    socket.removeEventListener("error", onError);
    socket.removeEventListener("close", onClose);
    signal?.removeEventListener("abort", onAbort);
  };
  function settle(
    result: Effect.Effect<openaiCodexWsConstructorTypes.WebSocketLike>,
    closeReason?: string,
  ): void {
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

function openSocket(
  WebSocketCtor: openaiCodexWsConstructorTypes.WebSocketConstructor,
  { url, headers, signal }: openaiCodexWsSocketTypes.WebSocketConnectRequest,
): Effect.Effect<openaiCodexWsConstructorTypes.WebSocketLike> {
  const wsHeaders = headersToRecord(headers);
  delete wsHeaders["OpenAI-Beta"];
  return Effect.callback<openaiCodexWsConstructorTypes.WebSocketLike>((resume) => {
    try {
      const socket = new WebSocketCtor(url, { headers: wsHeaders });
      return watchOpen({ resume, signal, socket });
    } catch (error) {
      resume(Effect.die(error instanceof Error ? error : new Error(String(error))));
      return undefined;
    }
  });
}

function connectWebSocket(
  request: openaiCodexWsSocketTypes.WebSocketConnectRequest,
): Effect.Effect<openaiCodexWsConstructorTypes.WebSocketLike> {
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

const openaiCodexWsSocket = {
  closeWebSocket,
  connectWebSocket,
  extractWebSocketCloseError,
  extractWebSocketError,
  isWebSocketReusable,
};

export default openaiCodexWsSocket;
