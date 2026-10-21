import platformNode from "../../../core/platform-node.ts";
import type cliTypes from "../cli.types.ts";
import type configTypes from "../config.types.ts";
import runtime from "../runtime.ts";
import type runtimeTypes from "../runtime.types.ts";

const { join } = platformNode;
const { McpServerConnection, McpServerLog, createDefaultTransport } = runtime;

function createConnection(
  entry: configTypes.McpServerEntry,
  options: cliTypes.McpCommandOptions,
  credentials: runtimeTypes.McpOAuthCredentialStore,
): runtimeTypes.McpServerConnection {
  return new McpServerConnection({
    createTransport: createDefaultTransport,
    credentials,
    cwd: options.cwd,
    entry,
    log: new McpServerLog(join(options.agentDir, "mcp.log")),
    onTools: () => {},
  });
}

function describeTransport(entry: configTypes.McpServerEntry): string {
  const { config } = entry;
  return "url" in config ? config.url : [config.command, ...(config.args ?? [])].join(" ");
}

const serverConnection = { createConnection, describeTransport };

export default serverConnection;
