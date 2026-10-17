import { McpError } from "./errors/mcp-error.ts";

export { McpAbortError } from "./errors/abort-error.ts";
export { McpClientError } from "./errors/client-error.ts";
export { McpConnectionClosedError } from "./errors/connection-closed-error.ts";
export { McpError } from "./errors/mcp-error.ts";
export { McpTimeoutError } from "./errors/timeout-error.ts";

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export const JSON_RPC_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

export function isJsonRpcRequest(message: unknown): message is JsonRpcRequest {
  return (
    isObject(message) &&
    message["jsonrpc"] === "2.0" &&
    isJsonRpcId(message["id"]) &&
    typeof message["method"] === "string"
  );
}

export function isJsonRpcNotification(message: unknown): message is JsonRpcNotification {
  return (
    isObject(message) &&
    message["jsonrpc"] === "2.0" &&
    !("id" in message) &&
    typeof message["method"] === "string"
  );
}

export function isJsonRpcResponse(message: unknown): message is JsonRpcResponse {
  if (!isObject(message) || message["jsonrpc"] !== "2.0" || !isJsonRpcId(message["id"]))
    return false;
  if ("result" in message) return !("error" in message);
  if (!("error" in message) || !isObject(message["error"])) return false;
  return (
    typeof message["error"]["code"] === "number" && typeof message["error"]["message"] === "string"
  );
}

export function parseJsonRpcMessage(value: unknown): JsonRpcMessage {
  if (isJsonRpcRequest(value) || isJsonRpcNotification(value) || isJsonRpcResponse(value))
    return value;
  throw new McpError(JSON_RPC_ERROR_CODES.invalidRequest, "Invalid JSON-RPC message");
}
