import type authProviderTypes from "../auth-provider.ts";
import type foreignTypes from "../foreign.types.ts";
import type jsonrpcTypes from "../protocol/jsonrpc.types.ts";
import type httpErrorTypes from "./errors/http-error.types.ts";
import type StreamableHttpConnectionClass from "./streamable-http-connection.ts";

declare namespace streamableHttpConnectionTypes {
  interface StreamableHttpReconnectOptions {
    initialDelayMs?: number;
    maxDelayMs?: number;
    maxRetries?: number;
  }

  interface StreamableHttpTransportOptions {
    url: string | URL;
    headers?: Record<string, string> | undefined;
    fetch?: authProviderTypes.McpFetch;
    openGetStream?: boolean;
    maxMessageBytes?: number;
    authProvider?: authProviderTypes.AuthProvider;
    reconnect?: StreamableHttpReconnectOptions;
  }

  type HttpFailure =
    | foreignTypes.McpForeignError
    | httpErrorTypes.McpHttpError
    | jsonrpcTypes.McpAbortError
    | jsonrpcTypes.McpConnectionClosedError;

  type StreamableHttpConnection = StreamableHttpConnectionClass;
}

export type { streamableHttpConnectionTypes as default };
