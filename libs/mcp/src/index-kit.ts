import McpClient from "./client.ts";
import foreign from "./foreign.ts";
import content from "./protocol/content.ts";
import McpAbortError from "./protocol/errors/abort-error.ts";
import McpClientError from "./protocol/errors/client-error.ts";
import McpConnectionClosedError from "./protocol/errors/connection-closed-error.ts";
import McpError from "./protocol/errors/mcp-error.ts";

const indexKit = {
  McpAbortError,
  McpClient,
  McpClientError,
  McpConnectionClosedError,
  McpError,
  content,
  foreign,
};

export default indexKit;
