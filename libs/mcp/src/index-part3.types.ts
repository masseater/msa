import type httpErrorTypes from "./transports/errors/http-error.types.ts";
import type sessionExpiredErrorTypes from "./transports/errors/session-expired-error.types.ts";
import type transportErrorTypes from "./transports/errors/transport-error.types.ts";
import type streamableHttpTypes from "./transports/streamable-http.types.ts";

declare namespace mcpTypesPart3 {
  type McpHttpError = httpErrorTypes.McpHttpError;
  type McpSessionExpiredError = sessionExpiredErrorTypes.McpSessionExpiredError;
  type McpTransportError = transportErrorTypes.McpTransportError;
  type StreamableHttpTransport = streamableHttpTypes.StreamableHttpTransport;
}

export type { mcpTypesPart3 as default };
