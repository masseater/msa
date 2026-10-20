import jsonrpcModule from "../protocol/jsonrpc.ts";
import type jsonrpcTypes from "../protocol/jsonrpc.types.ts";
import type transportTypes from "./transport.types.ts";

const { toError } = jsonrpcModule;

export default abstract class TransportEvents {
  private messageListeners = new Set<transportTypes.McpTransportMessageListener>();
  private errorListeners = new Set<transportTypes.McpTransportErrorListener>();
  private closeListeners = new Set<transportTypes.McpTransportCloseListener>();
  private closeEmitted = false;

  onMessage(listener: transportTypes.McpTransportMessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: transportTypes.McpTransportErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: transportTypes.McpTransportCloseListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  protected emitMessage(message: jsonrpcTypes.JsonRpcMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }

  protected emitError(error: unknown): void {
    const normalized = toError(error);
    for (const listener of this.errorListeners) listener(normalized);
  }

  protected emitClose(): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    for (const listener of this.closeListeners) listener();
  }
}
