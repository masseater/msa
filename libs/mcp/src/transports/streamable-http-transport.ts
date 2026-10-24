import { Clock, Effect, Result, Schema } from "effect";

import type jsonrpcTypes from "../protocol/jsonrpc.types.ts";
import type transportErrorTypes from "./errors/transport-error.types.ts";
import httpSupport from "./http-support.ts";
import type httpSupportTypes from "./http-support.types.ts";
import StreamableHttpConnection from "./streamable-http-connection.ts";
import type streamableHttpConnectionTypes from "./streamable-http-connection.types.ts";
import streamableHttpKit from "./streamable-http-kit.ts";
import type transportTypes from "./transport.types.ts";

const {
  foreign: foreignModule,
  McpHttpError,
  jsonrpc: jsonrpcModule,
  McpTransportError,
} = streamableHttpKit;

const { foreign, fromPromise, fromSync, toPromise } = foreignModule;
const {
  JSON_RPC_ERROR_CODES,
  McpConnectionClosedError,
  isJsonRpcRequest,
  isJsonRpcResponse,
  parseJsonRpcMessage,
  toError,
} = jsonrpcModule;
const { contentType, discard, isRetryable, newCursor, unwrapCause } = httpSupport;
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

export default class StreamableHttpTransport
  extends StreamableHttpConnection
  implements transportTypes.McpTransport
{
  private started = false;
  private getStreamStarted = false;

  get sessionId(): string | undefined {
    return this.sessionIdValue;
  }

  start(): Promise<void> {
    return toPromise(
      Effect.suspend(
        (): Effect.Effect<
          void,
          transportErrorTypes.McpTransportError | jsonrpcTypes.McpConnectionClosedError
        > => {
          if (this.started)
            return Effect.fail(
              McpTransportError.create("MCP Streamable HTTP transport already started"),
            );
          if (this.closed) return Effect.fail(McpConnectionClosedError.create());
          this.started = true;
          return Effect.void;
        },
      ),
    );
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  send(
    message: jsonrpcTypes.JsonRpcMessage,
    { signal }: transportTypes.McpTransportSendOptions = {},
  ): Promise<void> {
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
            fetch(url, { headers, method: "DELETE", signal: AbortSignal.timeout(1_000) }),
          ).pipe(Effect.flatMap(discard), Effect.ignore);
        }
        this.emitClose();
      }),
    );
  }

  private sendEffect(
    message: jsonrpcTypes.JsonRpcMessage,
    signal: AbortSignal | undefined,
  ): Effect.Effect<void, streamableHttpConnectionTypes.HttpFailure> {
    return Effect.gen({ self: this }, function* () {
      if (!this.started || this.closed) return yield* McpConnectionClosedError.create();
      const body = yield* encodeJson(message).pipe(Effect.mapError(foreign));
      const response = yield* this.authorizedFetch(
        "POST",
        {
          body,
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
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
    id: jsonrpcTypes.JsonRpcId,
    method: string,
  ): Effect.Effect<void, streamableHttpConnectionTypes.HttpFailure> {
    return Effect.gen({ self: this }, function* () {
      if (response.status === 202 || response.status === 204) {
        return yield* McpHttpError.create(
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
      return yield* McpHttpError.create(
        response.status,
        `Unsupported MCP response content type: ${type ?? "missing"}`,
      );
    });
  }

  private consumeResponseStream(
    body: ReadableStream<Uint8Array>,
    requestId: jsonrpcTypes.JsonRpcId,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const cursor = newCursor();
      let answered = false;
      const onMessage = (message: jsonrpcTypes.JsonRpcMessage) => {
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

  private failRequest(requestId: jsonrpcTypes.JsonRpcId, failure: unknown): void {
    const reason =
      failure === undefined ? "stream ended without a response" : toError(failure).message;
    this.emitMessage({
      error: {
        code: JSON_RPC_ERROR_CODES.internalError,
        message: `MCP response stream failed: ${reason}`,
      },
      id: requestId,
      jsonrpc: "2.0",
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
    cursor: httpSupportTypes.StreamCursor,
  ): Effect.Effect<
    "unsupported" | "healthy" | "dropped",
    streamableHttpConnectionTypes.HttpFailure
  > {
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
