import mcp from "@msa/mcp";
import type mcpTypes from "@msa/mcp/index.types";

import configModule from "../../../config.ts";
import platform from "../../../core/platform/index.ts";
import nodeUrl from "../../../core/platform/node/url.ts";
import type McpServerConnection from "../mcp-server-connection.ts";

const { pathToFileURL } = nodeUrl;

const { McpClient } = mcp;
const { basename } = platform;
const { VERSION } = configModule;

const createMcpClient = (connection: McpServerConnection): mcpTypes.McpClient => {
  const client = new McpClient({
    name: "msa",
    requestTimeoutMs: connection.timeoutMs,
    roots: [{ name: basename(connection.cwd), uri: pathToFileURL(connection.cwd).href }],
    version: VERSION,
  });
  const { log } = connection;
  if (log !== undefined) {
    client.onNotification("notifications/message", (params) =>
      log.write(connection.entry.name, params),
    );
  }
  return client;
};

export default createMcpClient;
