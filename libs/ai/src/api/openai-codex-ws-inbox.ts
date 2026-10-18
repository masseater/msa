import { Cause, Effect, Fiber, Stream } from "effect";

import { CodexStreamError, codexProtocolError, requestAbortedError } from "./openai-codex-error.ts";
import type { CodexRawEvent } from "./openai-codex-sse.ts";
import type { WebSocketLike, WebSocketListener } from "./openai-codex-ws-constructor.ts";
import {
  closeWebSocket,
  extractWebSocketCloseError,
  extractWebSocketError,
} from "./openai-codex-ws-socket.ts";

const CODEX_WEBSOCKET_COMPLETION_TYPES = new Set([
  "response.completed",
  "response.done",
  "response.incomplete",
]);

interface InboxState {
  readonly queue: CodexRawEvent[];
  pending: (() => void) | null;
  done: boolean;
  failed: unknown;
  sawCompletion: boolean;
}

export interface CodexWebSocketReader {
  readonly socket: WebSocketLike;
  readonly onListening: () => void;
  readonly signal: AbortSignal | undefined;
  readonly idleTimeoutMs: number | undefined;
}

function wake(state: InboxState): void {
  const resolve = state.pending;
  if (resolve === null) return;
  state.pending = null;
  resolve();
}

function fail(state: InboxState, error: unknown): void {
  state.failed = error;
  state.done = true;
  wake(state);
}

function decodeWebSocketText(data: ArrayBuffer | ArrayBufferView | string): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data));
  return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
}

function decodeWebSocketData(data: unknown): Effect.Effect<string | null> {
  if (typeof data === "string" || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return Effect.succeed(decodeWebSocketText(data));
  }
  if (typeof data === "object" && data !== null && "arrayBuffer" in data) {
    const blobLike = data as { arrayBuffer: () => Promise<ArrayBuffer> };
    return Effect.promise(() => blobLike.arrayBuffer()).pipe(Effect.map(decodeWebSocketText));
  }
  return Effect.succeed(null);
}

function parseMessage(text: string): CodexRawEvent {
  try {
    return JSON.parse(text) as CodexRawEvent;
  } catch (cause) {
    throw codexProtocolError({ source: "WebSocket", cause, payload: text });
  }
}

function accept(state: InboxState, text: string | null): void {
  if (text === null || text === "") return;
  const parsed = parseMessage(text);
  const type = typeof parsed["type"] === "string" ? parsed["type"] : "";
  if (CODEX_WEBSOCKET_COMPLETION_TYPES.has(type)) {
    state.sawCompletion = true;
    state.done = true;
  }
  state.queue.push(parsed);
  wake(state);
}

const asProtocolError = (cause: unknown): CodexStreamError =>
  cause instanceof CodexStreamError
    ? cause
    : codexProtocolError({ source: "WebSocket", cause, payload: null });

function inboxListeners(state: InboxState) {
  const message: WebSocketListener = (event) => {
    if (typeof event !== "object" || event === null || !("data" in event)) return;
    Effect.runFork(
      decodeWebSocketData((event as { data?: unknown }).data).pipe(
        Effect.map((text) => accept(state, text)),
        Effect.catchDefect((cause) => Effect.sync(() => fail(state, asProtocolError(cause)))),
      ),
    );
  };
  const error: WebSocketListener = (event) => fail(state, extractWebSocketError(event));
  const close: WebSocketListener = (event) => {
    if (!state.sawCompletion && state.failed === null) {
      state.failed = extractWebSocketCloseError(event);
    }
    state.done = true;
    wake(state);
  };
  return { message, error, close, abort: () => fail(state, requestAbortedError()) };
}

const interruptTimer = (timer: Fiber.Fiber<void> | undefined): void => {
  if (timer !== undefined) Effect.runFork(Fiber.interrupt(timer));
};

function waitForWake(state: InboxState, reader: CodexWebSocketReader): Effect.Effect<void> {
  const { idleTimeoutMs, socket } = reader;
  return Effect.callback<void>((resume) => {
    let idleTimer: Fiber.Fiber<void> | undefined;
    state.pending = () => {
      interruptTimer(idleTimer);
      resume(Effect.void);
    };
    if (idleTimeoutMs !== undefined && idleTimeoutMs > 0) {
      const timeout = Effect.sync(() => {
        const error = new Error(`WebSocket idle timeout after ${idleTimeoutMs}ms`);
        state.failed = error;
        state.done = true;
        state.pending = null;
        closeWebSocket("idle_timeout")(socket);
        resume(Effect.die(error));
      });
      idleTimer = Effect.runFork(Effect.sleep(idleTimeoutMs).pipe(Effect.andThen(timeout)));
    }
    return Effect.sync(() => {
      state.pending = null;
      interruptTimer(idleTimer);
    });
  });
}

function takeNext(
  state: InboxState,
  reader: CodexWebSocketReader,
): Effect.Effect<CodexRawEvent, Cause.Done> {
  return Effect.suspend(() => {
    if (reader.signal?.aborted === true) return Effect.die(requestAbortedError());
    const next = state.queue.shift();
    if (next !== undefined) return Effect.succeed(next);
    if (!state.done)
      return waitForWake(state, reader).pipe(Effect.andThen(takeNext(state, reader)));
    if (state.failed !== null) return Effect.die(state.failed);
    if (!state.sawCompletion) {
      return Effect.die(new Error("WebSocket stream closed before response.completed"));
    }
    return Cause.done();
  });
}

function openInbox(reader: CodexWebSocketReader) {
  const state: InboxState = {
    queue: [],
    pending: null,
    done: false,
    failed: null,
    sawCompletion: false,
  };
  const { socket, signal } = reader;
  const listeners = inboxListeners(state);
  socket.addEventListener("message", listeners.message);
  socket.addEventListener("error", listeners.error);
  socket.addEventListener("close", listeners.close);
  signal?.addEventListener("abort", listeners.abort);
  reader.onListening();
  const close = () => {
    socket.removeEventListener("message", listeners.message);
    socket.removeEventListener("error", listeners.error);
    socket.removeEventListener("close", listeners.close);
    signal?.removeEventListener("abort", listeners.abort);
  };
  return { take: takeNext(state, reader), close };
}

export const readCodexWebSocketEvents = (
  reader: CodexWebSocketReader,
): Stream.Stream<CodexRawEvent> =>
  Stream.unwrap(
    Effect.acquireRelease(
      Effect.sync(() => openInbox(reader)),
      (inbox) => Effect.sync(inbox.close),
    ).pipe(Effect.map((inbox) => Stream.fromEffectRepeat(inbox.take))),
  );
