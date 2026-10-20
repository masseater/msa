import indexKit from "./index-kit.ts";
import McpTimeoutError from "./protocol/errors/timeout-error.ts";
import jsonrpcModule from "./protocol/jsonrpc.ts";
import types from "./protocol/types.ts";
import McpAuthRequiredError from "./transports/errors/auth-required-error.ts";
import McpHttpError from "./transports/errors/http-error.ts";
import McpSessionExpiredError from "./transports/errors/session-expired-error.ts";
import McpTransportError from "./transports/errors/transport-error.ts";
import StdioTransport from "./transports/stdio.ts";
import streamableHttp from "./transports/streamable-http.ts";

const {
  McpAbortError,
  McpClient,
  McpClientError,
  McpConnectionClosedError,
  content: contentModule,
  foreign: foreignModule,
  McpError,
} = indexKit;

const mcp = {
  JSON_RPC_ERROR_CODES: jsonrpcModule.JSON_RPC_ERROR_CODES,
  LATEST_PROTOCOL_VERSION: types.LATEST_PROTOCOL_VERSION,
  McpAbortError: McpAbortError,
  McpAuthRequiredError: McpAuthRequiredError,
  McpClient: McpClient,
  McpClientError: McpClientError,
  McpConnectionClosedError: McpConnectionClosedError,
  McpError: McpError,
  McpForeignError: foreignModule.McpForeignError,
  McpHttpError: McpHttpError,
  McpSessionExpiredError: McpSessionExpiredError,
  McpTimeoutError: McpTimeoutError,
  McpTransportError: McpTransportError,
  SUPPORTED_PROTOCOL_VERSIONS: types.SUPPORTED_PROTOCOL_VERSIONS,
  StdioTransport: StdioTransport,
  StreamableHttpTransport: streamableHttp.StreamableHttpTransport,
  isJsonRpcNotification: jsonrpcModule.isJsonRpcNotification,
  isJsonRpcRequest: jsonrpcModule.isJsonRpcRequest,
  isJsonRpcResponse: jsonrpcModule.isJsonRpcResponse,
  parseJsonRpcMessage: jsonrpcModule.parseJsonRpcMessage,
  toLlmContent: contentModule.toLlmContent,
  toPromise: foreignModule.toPromise,
  unwrapForeign: foreignModule.unwrapForeign,
};

export default mcp;
