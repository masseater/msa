import type abortErrorTypes from "../protocol/errors/abort-error.types.ts";
import type clientErrorTypes from "../protocol/errors/client-error.types.ts";
import type connectionClosedErrorTypes from "../protocol/errors/connection-closed-error.types.ts";
import type mcpErrorTypes from "../protocol/errors/mcp-error.types.ts";
import type timeoutErrorTypes from "../protocol/errors/timeout-error.types.ts";
import type authRequiredErrorTypes from "../transports/errors/auth-required-error.types.ts";
import type httpErrorTypes from "../transports/errors/http-error.types.ts";
import type sessionExpiredErrorTypes from "../transports/errors/session-expired-error.types.ts";
import type transportErrorTypes from "../transports/errors/transport-error.types.ts";

declare namespace mcpErrorsKitTypes {
  type McpAbortError = abortErrorTypes.McpAbortError;
  type McpClientError = clientErrorTypes.McpClientError;
  type McpConnectionClosedError = connectionClosedErrorTypes.McpConnectionClosedError;
  type McpError = mcpErrorTypes.McpError;
  type McpTimeoutError = timeoutErrorTypes.McpTimeoutError;
  type McpAuthRequiredError = authRequiredErrorTypes.McpAuthRequiredError;
  type McpHttpError = httpErrorTypes.McpHttpError;
  type McpSessionExpiredError = sessionExpiredErrorTypes.McpSessionExpiredError;
  type McpTransportError = transportErrorTypes.McpTransportError;
}

export type { mcpErrorsKitTypes as default };
