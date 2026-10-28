import { Cause, Effect, Fiber, Schema, Stream } from "effect";

import openaiCodexError from "./openai-codex-error.ts";
import type openaiCodexErrorTypes from "./openai-codex-error.types.ts";
import type openaiCodexSseTypes from "./openai-codex-sse.types.ts";
import type openaiCodexWsConstructorTypes from "./openai-codex-ws-constructor.types.ts";
import type openaiCodexWsInboxTypes from "./openai-codex-ws-inbox.types.ts";
import openaiCodexWsSocket from "./openai-codex-ws-socket.ts";

const { CodexStreamError, codexProtocolError, requestAbortedError } = openaiCodexError;
const { closeWebSocket, extractWebSocketCloseError, extractWebSocketError } = openaiCodexWsSocket;

const CODEX_WEBSOCKET_COMPLETION_TYPES = new Set([
  "response.completed",
  "response.done",
  "response.incomplete",
]);

interface InboxState {
  readonly queue: openaiCodexSseTypes.CodexRawEvent[];
  pending: (() => void) | null;
  done: boolean;
  failed: unknown;
  sawCompletion: boolean;
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

function parseMessage(text: string): openaiCodexSseTypes.CodexRawEvent {
  try {
    return JSON.parse(text) as openaiCodexSseTypes.CodexRawEvent;
  } catch (cause) {
    throw codexProtocolError({ cause, payload: text, source: "WebSocket" });
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

const asProtocolError = (cause: unknown): openaiCodexErrorTypes.CodexStreamError =>
  Schema.is(CodexStreamError)(cause)
    ? cause
    : codexProtocolError({ cause, payload: null, source: "WebSocket" });

function inboxListeners(state: InboxState) {
  const message: openaiCodexWsConstructorTypes.WebSocketListener = (event) => {
    if (typeof event !== "object" || event === null || !("data" in event)) return;
    Effect.runFork(
      decodeWebSocketData((event as { data?: unknown }).data).pipe(
        Effect.map((text) => accept(state, text)),
        Effect.catchDefect((cause) => Effect.sync(() => fail(state, asProtocolError(cause)))),
      ),
    );
  };
  const error: openaiCodexWsConstructorTypes.WebSocketListener = (event) =>
    fail(state, extractWebSocketError(event));
  const close: openaiCodexWsConstructorTypes.WebSocketListener = (event) => {
    if (!state.sawCompletion && state.failed === null) {
      state.failed = extractWebSocketCloseError(event);
    }
    state.done = true;
    wake(state);
  };
  return { abort: () => fail(state, requestAbortedError()), close, error, message };
}

const interruptTimer = (timer: Fiber.Fiber<void> | undefined): void => {
  if (timer !== undefined) Effect.runFork(Fiber.interrupt(timer));
};

function waitForWake(
  state: InboxState,
  reader: openaiCodexWsInboxTypes.CodexWebSocketReader,
): Effect.Effect<void> {
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
  reader: openaiCodexWsInboxTypes.CodexWebSocketReader,
): Effect.Effect<openaiCodexSseTypes.CodexRawEvent, Cause.Done> {
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

function openInbox(reader: openaiCodexWsInboxTypes.CodexWebSocketReader) {
  const state: InboxState = {
    done: false,
    failed: null,
    pending: null,
    queue: [],
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
  return { close, take: takeNext(state, reader) };
}

const readCodexWebSocketEvents = (
  reader: openaiCodexWsInboxTypes.CodexWebSocketReader,
): Stream.Stream<openaiCodexSseTypes.CodexRawEvent> =>
  Stream.unwrap(
    Effect.acquireRelease(
      Effect.sync(() => openInbox(reader)),
      (inbox) => Effect.sync(inbox.close),
    ).pipe(Effect.map((inbox) => Stream.fromEffectRepeat(inbox.take))),
  );

const openaiCodexWsInbox = {
  readCodexWebSocketEvents,
};

export default openaiCodexWsInbox;
