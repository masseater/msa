import sse from "./sse.ts";
import streamableHttpKit from "./streamable-http-kit.ts";
import StreamableHttpTransport from "./streamable-http-transport.ts";

const { McpAuthRequiredError, McpHttpError, McpSessionExpiredError, McpTransportError } =
  streamableHttpKit;

const streamableHttp = {
  McpAuthRequiredError: McpAuthRequiredError,
  McpHttpError: McpHttpError,
  McpSessionExpiredError: McpSessionExpiredError,
  McpTransportError: McpTransportError,
  StreamableHttpTransport,
  consumeSseStream: sse.consumeSseStream,
};

export default streamableHttp;
