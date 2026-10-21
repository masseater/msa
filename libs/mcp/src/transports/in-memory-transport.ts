import { Effect } from "effect";

import jsonrpcModule from "../protocol/jsonrpc.ts";
import type jsonrpcTypes from "../protocol/jsonrpc.types.ts";
import transport from "./transport.ts";
import type transportTypes from "./transport.types.ts";

const { TransportEvents } = transport;
const { McpConnectionClosedError } = jsonrpcModule;

export default class InMemoryTransport
  extends TransportEvents
  implements transportTypes.McpTransport
{
  private peer: InMemoryTransport | undefined;
  private started = false;
  private closed = false;

  connectPeer(peer: InMemoryTransport): void {
    if (this.peer !== undefined) throw new Error("In-memory MCP transport already has a peer");
    this.peer = peer;
  }

  start(): Promise<void> {
    return Effect.runPromise(
      Effect.suspend(() => {
        if (this.closed) return Effect.fail(new McpConnectionClosedError());
        this.started = true;
        return Effect.void;
      }),
    );
  }

  send(message: jsonrpcTypes.JsonRpcMessage): Promise<void> {
    return Effect.runPromise(
      Effect.suspend(() => {
        if (!this.started || this.closed) return Effect.fail(new McpConnectionClosedError());
        const peer = this.peer;
        if (peer === undefined || !peer.started || peer.closed)
          return Effect.fail(new McpConnectionClosedError("In-memory MCP peer is not connected"));
        const copy = structuredClone(message);
        queueMicrotask(() => peer.deliver(copy));
        return Effect.void;
      }),
    );
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.emitClose();
    return this.peer?.close() ?? Promise.resolve();
  }

  override emitError(error: unknown): void {
    super.emitError(error);
  }

  private deliver(message: jsonrpcTypes.JsonRpcMessage): void {
    if (this.closed) return;
    this.emitMessage(message);
  }
}
