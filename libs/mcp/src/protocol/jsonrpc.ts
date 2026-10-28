import McpAbortError from "./errors/abort-error.ts";
import McpClientError from "./errors/client-error.ts";
import McpConnectionClosedError from "./errors/connection-closed-error.ts";
import McpError from "./errors/mcp-error.ts";
import McpTimeoutError from "./errors/timeout-error.ts";
import type jsonrpcTypes from "./jsonrpc.types.ts";

const JSON_RPC_ERROR_CODES = {
  internalError: -32603,
  invalidParams: -32602,
  invalidRequest: -32600,
  methodNotFound: -32601,
  parseError: -32700,
} as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isJsonRpcId(value: unknown): value is jsonrpcTypes.JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function isJsonRpcRequest(message: unknown): message is jsonrpcTypes.JsonRpcRequest {
  return (
    isObject(message) &&
    message["jsonrpc"] === "2.0" &&
    isJsonRpcId(message["id"]) &&
    typeof message["method"] === "string"
  );
}

function isJsonRpcNotification(message: unknown): message is jsonrpcTypes.JsonRpcNotification {
  return (
    isObject(message) &&
    message["jsonrpc"] === "2.0" &&
    !("id" in message) &&
    typeof message["method"] === "string"
  );
}

function isJsonRpcResponse(message: unknown): message is jsonrpcTypes.JsonRpcResponse {
  if (!isObject(message) || message["jsonrpc"] !== "2.0" || !isJsonRpcId(message["id"]))
    return false;
  if ("result" in message) return !("error" in message);
  if (!("error" in message) || !isObject(message["error"])) return false;
  return (
    typeof message["error"]["code"] === "number" && typeof message["error"]["message"] === "string"
  );
}

function parseJsonRpcMessage(value: unknown): jsonrpcTypes.JsonRpcMessage {
  if (isJsonRpcRequest(value) || isJsonRpcNotification(value) || isJsonRpcResponse(value))
    return value;
  throw McpError.create(JSON_RPC_ERROR_CODES.invalidRequest, "Invalid JSON-RPC message");
}

const jsonrpcModule = {
  JSON_RPC_ERROR_CODES,
  McpAbortError: McpAbortError,
  McpClientError: McpClientError,
  McpConnectionClosedError: McpConnectionClosedError,
  McpError: McpError,
  McpTimeoutError: McpTimeoutError,
  isJsonRpcId,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  isObject,
  parseJsonRpcMessage,
  toError,
};

export default jsonrpcModule;
