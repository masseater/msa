import type configTypes from "./config.types.ts";
import type connectionTypes from "./connection.types.ts";
import type logTypes from "./log.types.ts";
import type McpServerConnection from "./mcp-server-connection.ts";
import type oauthTypesNs from "./oauth.types.ts";

declare namespace mcpServerConnectionInternalTypes {
  type ServerState =
    | "connecting"
    | "connected"
    | "disconnected"
    | "needs-auth"
    | "failed"
    | "closed";

  interface ConnectionOptions {
    entry: configTypes.McpServerEntry;
    cwd: string;
    createTransport: connectionTypes.McpTransportFactory;
    credentials: oauthTypesNs.McpOAuthCredentialStore;
    providerToken?: (provider: string) => Promise<string | undefined>;
    onTools: (connection: McpServerConnection) => void;
    onChange?: (connection: McpServerConnection) => void;
    log?: logTypes.McpServerLog;
  }
}

export type { mcpServerConnectionInternalTypes as default };
