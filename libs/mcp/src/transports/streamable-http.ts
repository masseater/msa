import { Clock, Effect, Result, Schema } from "effect";

import { foreign, fromPromise, fromSync, toPromise } from "../foreign.ts";
import {
  isJsonRpcRequest,
  isJsonRpcResponse,
  JSON_RPC_ERROR_CODES,
  type JsonRpcId,
  type JsonRpcMessage,
  McpConnectionClosedError,
  parseJsonRpcMessage,
  toError,
} from "../protocol/jsonrpc.ts";
import { McpHttpError } from "./errors/http-error.ts";
import { McpTransportError } from "./errors/transport-error.ts";
import {
  contentType,
  discard,
  isRetryable,
  newCursor,
  type StreamCursor,
  unwrapCause,
} from "./http-support.ts";
import { type HttpFailure, StreamableHttpConnection } from "./streamable-http-connection.ts";
import type { McpTransport, McpTransportSendOptions } from "./transport.ts";

export { McpAuthRequiredError } from "./errors/auth-required-error.ts";
export { McpHttpError } from "./errors/http-error.ts";
export { McpSessionExpiredError } from "./errors/session-expired-error.ts";
export { McpTransportError } from "./errors/transport-error.ts";
export { type ConsumeSseOptions, consumeSseStream, type SseEvent } from "./sse.ts";
export type {
  StreamableHttpReconnectOptions,
  StreamableHttpTransportOptions,
} from "./streamable-http-connection.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export class StreamableHttpTransport extends StreamableHttpConnection implements McpTransport {
  private started = false;
  private getStreamStarted = false;

  get sessionId(): string | undefined {
    return this.sessionIdValue;
  }

  start(): Promise<void> {
    return toPromise(
      Effect.suspend((): Effect.Effect<void, McpTransportError | McpConnectionClosedError> => {
        if (this.started)
          return Effect.fail(
            new McpTransportError("MCP Streamable HTTP transport already started"),
          );
        if (this.closed) return Effect.fail(new McpConnectionClosedError());
        this.started = true;
        return Effect.void;
      }),
    );
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  send(message: JsonRpcMessage, { signal }: McpTransportSendOptions = {}): Promise<void> {
    return toPromise(this.sendEffect(message, signal));
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.controller.abort();
    return toPromise(
      Effect.gen({ self: this }, function* () {
        const sessionId = this.sessionIdValue;
        if (this.started && sessionId !== undefined && sessionId !== "") {
          const headers = this.buildHeaders({}, this.lastToken);
          const fetch = this.fetch;
          const url = this.url;
          yield* fromPromise(() =>
            fetch(url, { method: "DELETE", headers, signal: AbortSignal.timeout(1_000) }),
          ).pipe(Effect.flatMap(discard), Effect.ignore);
        }
        this.emitClose();
      }),
    );
  }

  private sendEffect(
    message: JsonRpcMessage,
    signal: AbortSignal | undefined,
  ): Effect.Effect<void, HttpFailure> {
    return Effect.gen({ self: this }, function* () {
      if (!this.started || this.closed) return yield* new McpConnectionClosedError();
      const body = yield* encodeJson(message).pipe(Effect.mapError(foreign));
      const response = yield* this.authorizedFetch(
        "POST",
        {
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
          body,
        },
        signal,
      );
      yield* this.checkResponse(response);
      this.captureSession(response);
      if (!isJsonRpcRequest(message)) {
        yield* discard(response);
        if ("method" in message && message.method === "notifications/initialized")
          this.startGetStream();
        return;
      }
      yield* this.readReply(response, message.id, message.method);
    });
  }

  private readReply(
    response: Response,
    id: JsonRpcId,
    method: string,
  ): Effect.Effect<void, HttpFailure> {
    return Effect.gen({ self: this }, function* () {
      if (response.status === 202 || response.status === 204) {
        return yield* new McpHttpError(
          response.status,
          `MCP server accepted request ${method} without a response`,
        );
      }
      const type = contentType(response);
      if (type === "application/json") {
        const body = yield* fromPromise((): Promise<unknown> => response.json());
        yield* fromSync(() => {
          for (const item of Array.isArray(body) ? body : [body])
            this.emitMessage(parseJsonRpcMessage(item));
        });
        return;
      }
      if (type === "text/event-stream" && response.body !== null) {
        yield* Effect.forkDetach(this.consumeResponseStream(response.body, id));
        return;
      }
      yield* discard(response);
      return yield* new McpHttpError(
        response.status,
        `Unsupported MCP response content type: ${type ?? "missing"}`,
      );
    });
  }

  private consumeResponseStream(
    body: ReadableStream<Uint8Array>,
    requestId: JsonRpcId,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const cursor = newCursor();
      let answered = false;
      const onMessage = (message: JsonRpcMessage) => {
        if (isJsonRpcResponse(message) && message.id === requestId) answered = true;
      };
      let stream: ReadableStream<Uint8Array> | undefined = body;
      let failure: unknown;
      for (let attempt = 0; ;) {
        if (stream !== undefined) {
          const outcome = yield* Effect.result(this.consumeSse(stream, cursor, onMessage));
          failure = Result.isFailure(outcome) ? outcome.failure : undefined;
        }
        if (answered || this.closed) return;
        if (failure !== undefined && !isRetryable(failure)) break;
        if (cursor.lastEventId === undefined || attempt >= this.maxRetries()) break;
        if (cursor.received) attempt = 0;
        cursor.received = false;
        if (!(yield* this.sleep(this.reconnectDelay(attempt++, cursor.retryMs)))) return;
        const reopened = yield* Effect.result(this.openSseStream(cursor.lastEventId));
        if (Result.isSuccess(reopened)) stream = reopened.success;
        else {
          failure = reopened.failure;
          if (!isRetryable(reopened.failure)) break;
          stream = undefined;
        }
      }
      if (this.closed) return;
      this.failRequest(requestId, failure);
    });
  }

  private failRequest(requestId: JsonRpcId, failure: unknown): void {
    const reason =
      failure === undefined ? "stream ended without a response" : toError(failure).message;
    this.emitMessage({
      jsonrpc: "2.0",
      id: requestId,
      error: {
        code: JSON_RPC_ERROR_CODES.internalError,
        message: `MCP response stream failed: ${reason}`,
      },
    });
  }

  private startGetStream(): void {
    if (this.options.openGetStream === false || this.getStreamStarted || this.closed) return;
    this.getStreamStarted = true;
    Effect.runFork(this.runGetStream());
  }

  private runGetStream(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const cursor = newCursor();
      for (let attempt = 0; !this.closed;) {
        const outcome = yield* Effect.result(this.readGetStream(cursor));
        if (Result.isSuccess(outcome)) {
          if (outcome.success === "unsupported") return;
          if (outcome.success === "healthy") attempt = 0;
        } else {
          if (this.closed) return;
          if (!isRetryable(outcome.failure)) {
            this.emitError(unwrapCause(outcome.failure));
            return;
          }
        }
        cursor.received = false;
        if (attempt >= this.maxRetries()) {
          this.emitError(
            new Error("MCP server-to-client stream dropped and could not be reopened"),
          );
          return;
        }
        if (!(yield* this.sleep(this.reconnectDelay(attempt++, cursor.retryMs)))) return;
      }
    });
  }

  private readGetStream(
    cursor: StreamCursor,
  ): Effect.Effect<"unsupported" | "healthy" | "dropped", HttpFailure> {
    return Effect.gen({ self: this }, function* () {
      const stream = yield* this.openSseStream(cursor.lastEventId);
      if (stream === undefined) return "unsupported" as const;
      const openedAt = yield* Clock.currentTimeMillis;
      yield* this.consumeSse(stream, cursor);
      const now = yield* Clock.currentTimeMillis;
      return cursor.received || now - openedAt > this.maxDelay()
        ? ("healthy" as const)
        : ("dropped" as const);
    });
  }
}
