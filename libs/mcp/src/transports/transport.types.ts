import type jsonrpcTypes from "../protocol/jsonrpc.types.ts";
import type transport from "./transport.ts";

declare namespace transportTypes {
  type McpTransportMessageListener = (message: jsonrpcTypes.JsonRpcMessage) => void;

  type McpTransportErrorListener = (error: Error) => void;

  type McpTransportCloseListener = () => void;

  interface McpTransportSendOptions {
    signal?: AbortSignal;
  }

  interface McpTransport {
    start(): Promise<void>;
    send(message: jsonrpcTypes.JsonRpcMessage, options?: McpTransportSendOptions): Promise<void>;
    close(): Promise<void>;
    onMessage(listener: McpTransportMessageListener): () => void;
    onError(listener: McpTransportErrorListener): () => void;
    onClose(listener: McpTransportCloseListener): () => void;
    setProtocolVersion?(version: string): void;
  }

  type TransportEvents = (typeof transport.TransportEvents)["prototype"];
}

export type { transportTypes as default };
