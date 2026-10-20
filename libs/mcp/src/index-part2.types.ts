import type foreignTypes from "./foreign.types.ts";
import type abortErrorTypes from "./protocol/errors/abort-error.types.ts";
import type clientErrorTypes from "./protocol/errors/client-error.types.ts";
import type connectionClosedErrorTypes from "./protocol/errors/connection-closed-error.types.ts";
import type mcpErrorTypes from "./protocol/errors/mcp-error.types.ts";
import type timeoutErrorTypes from "./protocol/errors/timeout-error.types.ts";
import type authRequiredErrorTypes from "./transports/errors/auth-required-error.types.ts";
import type transportTypes from "./transports/transport.types.ts";

declare namespace mcpTypesPart2 {
  type McpTransport = transportTypes.McpTransport;
  type McpTransportCloseListener = transportTypes.McpTransportCloseListener;
  type McpTransportErrorListener = transportTypes.McpTransportErrorListener;
  type McpTransportMessageListener = transportTypes.McpTransportMessageListener;
  type McpTransportSendOptions = transportTypes.McpTransportSendOptions;
  type McpForeignError = foreignTypes.McpForeignError;
  type McpAbortError = abortErrorTypes.McpAbortError;
  type McpClientError = clientErrorTypes.McpClientError;
  type McpConnectionClosedError = connectionClosedErrorTypes.McpConnectionClosedError;
  type McpError = mcpErrorTypes.McpError;
  type McpTimeoutError = timeoutErrorTypes.McpTimeoutError;
  type McpAuthRequiredError = authRequiredErrorTypes.McpAuthRequiredError;
}

export type { mcpTypesPart2 as default };
