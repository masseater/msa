import { Effect } from "effect";

import type { AuthProvider, McpFetch } from "../auth-provider.ts";
import { fromPromise, type McpForeignError } from "../foreign.ts";
import {
  type JsonRpcMessage,
  McpAbortError,
  type McpConnectionClosedError,
  parseJsonRpcMessage,
} from "../protocol/jsonrpc.ts";
import { McpAuthRequiredError } from "./errors/auth-required-error.ts";
import { McpHttpError } from "./errors/http-error.ts";
import { McpSessionExpiredError } from "./errors/session-expired-error.ts";
import {
  contentType,
  describeHttpFailure,
  discard,
  needsAuthorization,
  sleepUnlessAborted,
  type StreamCursor,
} from "./http-support.ts";
import { consumeSseStream } from "./sse.ts";
import { DEFAULT_MAX_MESSAGE_BYTES, TransportEvents } from "./transport.ts";

const MAX_ERROR_BODY_BYTES = 8 * 1024;
const DEFAULT_RECONNECT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 30_000;
const DEFAULT_RECONNECT_MAX_RETRIES = 5;

export interface StreamableHttpReconnectOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxRetries?: number;
}

export interface StreamableHttpTransportOptions {
  url: string | URL;
  headers?: Record<string, string> | undefined;
  fetch?: McpFetch;
  openGetStream?: boolean;
  maxMessageBytes?: number;
  authProvider?: AuthProvider;
  reconnect?: StreamableHttpReconnectOptions;
}

export type HttpFailure = McpForeignError | McpHttpError | McpAbortError | McpConnectionClosedError;

export abstract class StreamableHttpConnection extends TransportEvents {
  readonly url: URL;
  readonly options: Readonly<StreamableHttpTransportOptions>;
  protected fetch: McpFetch;
  protected controller = new AbortController();
  protected closed = false;
  protected sessionIdValue: string | undefined;
  protected protocolVersion: string | undefined;
  protected lastToken: string | undefined;

  constructor(options: StreamableHttpTransportOptions) {
    super();
    this.options = Object.freeze({
      ...options,
      headers: options.headers === undefined ? undefined : { ...options.headers },
    });
    this.url = new URL(options.url);
    const fetch = options.fetch ?? globalThis.fetch;
    this.fetch = (input, init) => fetch(input, init);
  }

  protected authorizedFetch(
    method: "GET" | "POST",
    init: { headers: Record<string, string>; body?: string },
    signal?: AbortSignal,
  ): Effect.Effect<Response, McpForeignError | McpAbortError> {
    return Effect.gen({ self: this }, function* () {
      const provider = this.options.authProvider;
      const onUnauthorized = provider?.onUnauthorized?.bind(provider);
      for (let attempt = 0; ; attempt++) {
        const { headers, token } = yield* this.headers(init.headers);
        if (signal?.aborted === true) return yield* new McpAbortError();
        const fetch = this.fetch;
        const url = this.url;
        const controllerSignal = this.controller.signal;
        const response = yield* fromPromise(() =>
          fetch(url, {
            method,
            headers,
            ...(init.body === undefined ? {} : { body: init.body }),
            signal: controllerSignal,
          }),
        );
        if (attempt > 0 || onUnauthorized === undefined || !needsAuthorization(response))
          return response;
        const context = { response, serverUrl: url, fetch, token };
        yield* fromPromise(() => onUnauthorized(context)).pipe(Effect.ensuring(discard(response)));
      }
    });
  }

  protected headers(
    extra: Record<string, string> = {},
  ): Effect.Effect<{ headers: Headers; token?: string }, McpForeignError> {
    const provider = this.options.authProvider;
    return fromPromise(() => provider?.token()).pipe(
      Effect.map((token) => {
        this.lastToken = token;
        return {
          headers: this.buildHeaders(extra, token),
          ...(token !== undefined && token !== "" ? { token } : {}),
        };
      }),
    );
  }

  protected buildHeaders(extra: Record<string, string>, token: string | undefined): Headers {
    const headers = new Headers(this.options.headers);
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);
    const sessionId = this.sessionIdValue;
    if (sessionId !== undefined && sessionId !== "") headers.set("Mcp-Session-Id", sessionId);
    const protocolVersion = this.protocolVersion;
    if (protocolVersion !== undefined && protocolVersion !== "")
      headers.set("MCP-Protocol-Version", protocolVersion);
    if (token !== undefined && token !== "") headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  protected captureSession(response: Response): void {
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId !== null && sessionId !== "") this.sessionIdValue = sessionId;
  }

  protected checkResponse(response: Response): Effect.Effect<void, McpHttpError> {
    if (response.ok) return Effect.void;
    return Effect.gen({ self: this }, function* () {
      const text = yield* Effect.promise(() => response.text().catch(() => ""));
      const body = text.slice(0, MAX_ERROR_BODY_BYTES);
      if (response.status === 401) return yield* new McpAuthRequiredError(response, body);
      const sessionId = this.sessionIdValue;
      if (response.status === 404 && sessionId !== undefined && sessionId !== "")
        return yield* new McpSessionExpiredError(body);
      return yield* new McpHttpError(
        response.status,
        describeHttpFailure(response.status, body),
        body,
      );
    });
  }

  protected consumeSse(
    stream: ReadableStream<Uint8Array>,
    cursor: StreamCursor,
    onMessage?: (message: JsonRpcMessage) => void,
  ): Effect.Effect<void, McpForeignError> {
    return consumeSseStream(stream, {
      maxEventBytes: this.options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES,
      onId: (id) => {
        cursor.lastEventId = id;
      },
      onRetry: (delayMs) => {
        cursor.retryMs = delayMs;
      },
      onEvent: (event) => {
        cursor.received = true;
        if (event.data.trim() === "" || (event.event !== undefined && event.event !== "message"))
          return;
        let message: JsonRpcMessage;
        try {
          message = parseJsonRpcMessage(JSON.parse(event.data));
        } catch (error) {
          this.emitError(error);
          return;
        }
        onMessage?.(message);
        this.emitMessage(message);
      },
    });
  }

  protected openSseStream(
    lastEventId: string | undefined,
  ): Effect.Effect<ReadableStream<Uint8Array> | undefined, HttpFailure> {
    return Effect.gen({ self: this }, function* () {
      const response = yield* this.authorizedFetch("GET", {
        headers: {
          accept: "text/event-stream",
          ...(lastEventId === undefined ? {} : { "last-event-id": lastEventId }),
        },
      });
      if (response.status === 405) {
        yield* discard(response);
        return undefined;
      }
      yield* this.checkResponse(response);
      this.captureSession(response);
      const type = contentType(response);
      if (type !== "text/event-stream" || response.body === null) {
        yield* discard(response);
        return yield* new McpHttpError(
          response.status,
          `Unsupported MCP GET response content type: ${type ?? "missing"}`,
        );
      }
      return response.body;
    });
  }

  protected reconnectDelay(attempt: number, serverDelayMs: number | undefined): number {
    if (serverDelayMs !== undefined) return serverDelayMs;
    const initial = this.options.reconnect?.initialDelayMs ?? DEFAULT_RECONNECT_INITIAL_DELAY_MS;
    return Math.min(initial * 2 ** attempt, this.maxDelay());
  }

  protected maxDelay(): number {
    return this.options.reconnect?.maxDelayMs ?? DEFAULT_RECONNECT_MAX_DELAY_MS;
  }

  protected maxRetries(): number {
    return this.options.reconnect?.maxRetries ?? DEFAULT_RECONNECT_MAX_RETRIES;
  }

  protected sleep(ms: number): Effect.Effect<boolean> {
    const signal = this.controller.signal;
    return sleepUnlessAborted(ms, signal);
  }
}
