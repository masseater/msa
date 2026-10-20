import type mcpTypes from "@msa/mcp/index.types";
import type oauthTypes from "@msa/mcp/oauth.types";

import type configTypes from "./config.types.ts";
import type connectionTypes from "./connection.types.ts";
import type logTypes from "./log.types.ts";
import type mcpServerConnectionInternalTypes from "./mcp-server-connection-internal.types.ts";
import type McpServerConnection from "./mcp-server-connection.ts";
import type oauthTypesNs from "./oauth.types.ts";

export default abstract class McpServerConnectionLayer0 {
  entry!: configTypes.McpServerEntry;
  state: mcpServerConnectionInternalTypes.ServerState = "connecting";
  error!: string | undefined;
  tools: mcpTypes.Tool[] = [];
  hasResources = false;
  instructions!: string | undefined;
  challenge!: oauthTypes.OAuthChallenge | undefined;
  protected client!: mcpTypes.McpClient | undefined;
  protected opening!: Promise<mcpTypes.McpClient> | undefined;
  protected readonly shutdown = new AbortController();
  protected stderrTail!: string | undefined;
  cwd!: string;
  createTransport!: connectionTypes.McpTransportFactory;
  protected authProvider!: oauthTypesNs.McpAuthProvider | undefined;
  onTools!: (connection: McpServerConnection) => void;
  onChange!: ((connection: McpServerConnection) => void) | undefined;
  log!: logTypes.McpServerLog | undefined;
}
