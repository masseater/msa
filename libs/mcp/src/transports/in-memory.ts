import { Effect } from "effect";

import { type JsonRpcMessage, McpConnectionClosedError } from "../protocol/jsonrpc.ts";
import { type McpTransport, TransportEvents } from "./transport.ts";

export class InMemoryTransport extends TransportEvents implements McpTransport {
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

  send(message: JsonRpcMessage): Promise<void> {
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

  private deliver(message: JsonRpcMessage): void {
    if (this.closed) return;
    this.emitMessage(message);
  }
}

export function createInMemoryTransportPair(): {
  client: InMemoryTransport;
  server: InMemoryTransport;
} {
  const client = new InMemoryTransport();
  const server = new InMemoryTransport();
  client.connectPeer(server);
  server.connectPeer(client);
  return { client, server };
}
