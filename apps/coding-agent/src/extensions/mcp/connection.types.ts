import type mcpTypes from "@msa/mcp/index.types";

import type configTypes from "./config.types.ts";
import type logTypes from "./log.types.ts";
import type McpServerConnectionClass from "./mcp-server-connection.ts";
import type oauthTypesNs from "./oauth.types.ts";

declare namespace connectionTypes {
  type McpTransportFactory = (
    entry: configTypes.McpServerEntry,
    cwd: string,
    authProvider: mcpTypes.AuthProvider | undefined,
  ) => mcpTypes.McpTransport;

  type McpServerConnection = (typeof McpServerConnectionClass)["prototype"];

  type McpServerLog = logTypes.McpServerLog;

  type McpOAuthCredentialStore = oauthTypesNs.McpOAuthCredentialStore;

  type McpSignInCancelledError = oauthTypesNs.McpSignInCancelledError;
}

export type { connectionTypes as default };
