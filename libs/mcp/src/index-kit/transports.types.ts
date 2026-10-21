import type stdioTypes from "../transports/stdio.types.ts";
import type streamableHttpConnectionTypes from "../transports/streamable-http-connection.types.ts";
import type streamableHttpTypes from "../transports/streamable-http.types.ts";
import type transportTypes from "../transports/transport.types.ts";

declare namespace mcpTransportsKitTypes {
  type StdioTransportOptions = stdioTypes.StdioTransportOptions;
  type StreamableHttpTransportOptions =
    streamableHttpConnectionTypes.StreamableHttpTransportOptions;
  type StdioTransport = stdioTypes.StdioTransport;
  type McpTransport = transportTypes.McpTransport;
  type McpTransportCloseListener = transportTypes.McpTransportCloseListener;
  type McpTransportErrorListener = transportTypes.McpTransportErrorListener;
  type McpTransportMessageListener = transportTypes.McpTransportMessageListener;
  type McpTransportSendOptions = transportTypes.McpTransportSendOptions;
  type StreamableHttpTransport = streamableHttpTypes.StreamableHttpTransport;
}

export type { mcpTransportsKitTypes as default };
