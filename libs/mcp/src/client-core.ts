import { Deferred, Effect } from "effect";

import type { McpRequestFailure } from "./client-results.ts";
import { foreign, fromPromise, type McpForeignError, toPromise } from "./foreign.ts";
import { IncomingRequests, type RequestHandler } from "./incoming-requests.ts";
import { type PendingRequest, PendingRequests } from "./pending-requests.ts";
import {
  isJsonRpcId,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  isObject,
  JSON_RPC_ERROR_CODES,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  McpAbortError,
  McpConnectionClosedError,
  McpError,
  toError,
} from "./protocol/jsonrpc.ts";
import type { ProgressNotification } from "./protocol/types.ts";
import type { McpTransport } from "./transports/transport.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export type ClientState = "idle" | "connecting" | "connected" | "closed";
type NotificationListener = (params: unknown) => void;
type ErrorListener = (error: Error) => void;
type CloseListener = () => void;

export interface McpRequestOptions {
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
  onProgress?: (progress: ProgressNotification) => void;
}

export abstract class McpClientCore {
  protected state: ClientState = "idle";
  protected transport: McpTransport | undefined;
  protected disposers: (() => void)[] = [];
  protected incoming = new IncomingRequests((error) => this.emitError(error));
  private nextRequestId = 1;
  private requestTimeoutMs: number | undefined;
  private pending = new PendingRequests((id, reason) => {
    const transport = this.transport;
    if (transport === undefined) return;
    this.sendQuietly(transport, {
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: id, ...(reason !== undefined && reason !== "" ? { reason } : {}) },
    });
  });
  private notificationListeners = new Map<string, Set<NotificationListener>>();
  private errorListeners = new Set<ErrorListener>();
  private closeListeners = new Set<CloseListener>();

  constructor(requestTimeoutMs: number | undefined) {
    this.requestTimeoutMs = requestTimeoutMs;
  }

  get connectionState(): ClientState {
    return this.state;
  }

  request<Result = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options: McpRequestOptions = {},
  ): Promise<Result> {
    return toPromise(this.requestEffect(method, params, options, false)) as Promise<Result>;
  }

  notify(method: string, params?: Record<string, unknown>): Promise<void> {
    return toPromise(this.notifyEffect(method, params, false));
  }

  setRequestHandler(method: string, handler: RequestHandler): () => void {
    return this.incoming.setHandler(method, handler);
  }

  onNotification(method: string, listener: NotificationListener): () => void {
    const listeners = this.notificationListeners.get(method) ?? new Set<NotificationListener>();
    this.notificationListeners.set(method, listeners);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.notificationListeners.delete(method);
    };
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: CloseListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): Promise<void> {
    const transport = this.transport;
    this.transport = undefined;
    for (const dispose of this.disposers.splice(0)) dispose();
    this.markClosed(new McpConnectionClosedError());
    return transport?.close() ?? Promise.resolve();
  }

  protected requestEffect(
    method: string,
    params: Record<string, unknown> | undefined,
    options: McpRequestOptions,
    allowConnecting: boolean,
  ): Effect.Effect<unknown, McpRequestFailure> {
    return Effect.suspend((): Effect.Effect<unknown, McpRequestFailure> => {
      const transport = this.requireTransport(allowConnecting);
      if (transport === undefined)
        return Effect.fail(new McpConnectionClosedError(`MCP client is ${this.state}`));
      if (options.signal?.aborted === true) return Effect.fail(new McpAbortError());
      const id = this.nextRequestId++;
      const progressToken = options.onProgress === undefined ? undefined : id;
      const meta = params?.["_meta"];
      const requestParams =
        progressToken === undefined
          ? params
          : { ...params, _meta: { ...(isObject(meta) ? meta : {}), progressToken } };
      const message: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        ...(requestParams === undefined ? {} : { params: requestParams }),
      };
      const entry: PendingRequest = {
        deferred: Deferred.makeUnsafe<unknown, McpForeignError>(),
        timeoutMs: options.timeoutMs ?? this.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        timer: undefined,
        signal: options.signal,
        onAbort: () =>
          this.pending.cancel(
            id,
            new McpAbortError(),
            method !== "initialize",
            String(options.signal?.reason ?? "Aborted"),
          ),
        sendController: new AbortController(),
        cancellable: method !== "initialize",
        onProgress: options.onProgress,
        progressToken,
      };
      this.pending.add(id, entry);
      transport
        .send(message, { signal: entry.sendController.signal })
        .catch((error: unknown) => this.pending.cancel(id, error, false));
      return Deferred.await(entry.deferred);
    });
  }

  protected notifyEffect(
    method: string,
    params: Record<string, unknown> | undefined,
    allowConnecting: boolean,
  ): Effect.Effect<void, McpForeignError | McpConnectionClosedError> {
    return Effect.suspend((): Effect.Effect<void, McpForeignError | McpConnectionClosedError> => {
      const transport = this.requireTransport(allowConnecting);
      if (transport === undefined)
        return Effect.fail(new McpConnectionClosedError(`MCP client is ${this.state}`));
      return fromPromise(() =>
        transport.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) }),
      );
    });
  }

  protected handleMessage(message: JsonRpcMessage): void {
    if (isJsonRpcResponse(message)) this.handleResponse(message);
    else if (isJsonRpcRequest(message)) {
      const transport = this.transport;
      if (transport !== undefined) this.incoming.handle(transport, message);
    } else if (isJsonRpcNotification(message))
      this.handleNotification(message.method, message.params);
    else
      this.emitError(
        new McpError(JSON_RPC_ERROR_CODES.invalidRequest, "Received invalid JSON-RPC message"),
      );
  }

  protected markClosed(error: Error): void {
    const wasClosed = this.state === "closed";
    this.state = "closed";
    this.pending.rejectAll(error);
    this.incoming.abortAll(error);
    if (wasClosed) return;
    for (const listener of [...this.closeListeners]) {
      try {
        listener();
      } catch (listenerError) {
        this.emitError(listenerError);
      }
    }
  }

  protected emitError(error: unknown): void {
    const normalized = toError(error);
    for (const listener of this.errorListeners) listener(normalized);
  }

  private requireTransport(allowConnecting: boolean): McpTransport | undefined {
    const usable = this.state === "connected" || (allowConnecting && this.state === "connecting");
    return usable ? this.transport : undefined;
  }

  private sendQuietly(transport: McpTransport, message: JsonRpcMessage): void {
    transport.send(message).catch((error: unknown) => this.emitError(error));
  }

  private handleResponse(message: JsonRpcResponse): void {
    const outcome =
      "error" in message
        ? Effect.fail(
            foreign(new McpError(message.error.code, message.error.message, message.error.data)),
          )
        : Effect.succeed(message.result);
    if (!this.pending.resolve(message.id, outcome))
      this.emitError(new Error(`Received response for unknown MCP request ${String(message.id)}`));
  }

  private handleNotification(method: string, params: unknown): void {
    if (method === "notifications/progress") this.handleProgress(params);
    else if (method === "notifications/cancelled") this.handleCancelled(params);
    for (const listener of this.notificationListeners.get(method) ?? []) {
      try {
        listener(params);
      } catch (error) {
        this.emitError(error);
      }
    }
  }

  private handleProgress(params: unknown): void {
    if (
      !isObject(params) ||
      !isJsonRpcId(params["progressToken"]) ||
      typeof params["progress"] !== "number"
    )
      return;
    const entry = this.pending.progress(params["progressToken"]);
    try {
      entry?.onProgress?.(params as unknown as ProgressNotification);
    } catch (error) {
      this.emitError(error);
    }
  }

  private handleCancelled(params: unknown): void {
    if (isObject(params) && isJsonRpcId(params["requestId"]))
      this.incoming.abort(params["requestId"], params["reason"]);
  }
}
