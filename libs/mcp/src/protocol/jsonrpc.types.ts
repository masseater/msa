import type abortErrorTypes from "./errors/abort-error.types.ts";
import type clientErrorTypes from "./errors/client-error.types.ts";
import type connectionClosedErrorTypes from "./errors/connection-closed-error.types.ts";
import type mcpErrorTypes from "./errors/mcp-error.types.ts";
import type timeoutErrorTypes from "./errors/timeout-error.types.ts";

declare namespace jsonrpcTypes {
  type JsonRpcId = string | number;

  interface JsonRpcRequest {
    jsonrpc: "2.0";
    id: JsonRpcId;
    method: string;
    params?: unknown;
  }

  interface JsonRpcNotification {
    jsonrpc: "2.0";
    method: string;
    params?: unknown;
  }

  interface JsonRpcErrorObject {
    code: number;
    message: string;
    data?: unknown;
  }

  interface JsonRpcSuccessResponse {
    jsonrpc: "2.0";
    id: JsonRpcId;
    result: unknown;
  }

  interface JsonRpcErrorResponse {
    jsonrpc: "2.0";
    id: JsonRpcId;
    error: JsonRpcErrorObject;
  }

  type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

  type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

  type McpAbortError = abortErrorTypes.McpAbortError;

  type McpClientError = clientErrorTypes.McpClientError;

  type McpConnectionClosedError = connectionClosedErrorTypes.McpConnectionClosedError;

  type McpError = mcpErrorTypes.McpError;

  type McpTimeoutError = timeoutErrorTypes.McpTimeoutError;
}

export type { jsonrpcTypes as default };
