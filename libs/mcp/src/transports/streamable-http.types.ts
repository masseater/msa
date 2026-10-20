import type authRequiredErrorTypes from "./errors/auth-required-error.types.ts";
import type httpErrorTypes from "./errors/http-error.types.ts";
import type sessionExpiredErrorTypes from "./errors/session-expired-error.types.ts";
import type transportErrorTypes from "./errors/transport-error.types.ts";
import type sseTypes from "./sse.types.ts";
import type streamableHttpConnectionTypes from "./streamable-http-connection.types.ts";
import type streamableHttp from "./streamable-http.ts";

declare namespace streamableHttpTypes {
  type ConsumeSseOptions = sseTypes.ConsumeSseOptions;

  type SseEvent = sseTypes.SseEvent;

  type StreamableHttpReconnectOptions =
    streamableHttpConnectionTypes.StreamableHttpReconnectOptions;

  type StreamableHttpTransportOptions =
    streamableHttpConnectionTypes.StreamableHttpTransportOptions;

  type McpAuthRequiredError = authRequiredErrorTypes.McpAuthRequiredError;

  type McpHttpError = httpErrorTypes.McpHttpError;

  type McpSessionExpiredError = sessionExpiredErrorTypes.McpSessionExpiredError;

  type McpTransportError = transportErrorTypes.McpTransportError;

  type StreamableHttpTransport = (typeof streamableHttp.StreamableHttpTransport)["prototype"];
}

export type { streamableHttpTypes as default };
