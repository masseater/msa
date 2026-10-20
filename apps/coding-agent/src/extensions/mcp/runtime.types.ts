import type connectionTypes from "./connection.types.ts";
import type logTypes from "./log.types.ts";
import type oauthTypesNs from "./oauth.types.ts";

declare namespace runtimeTypes {
  type McpServerConnection = connectionTypes.McpServerConnection;

  type McpTransportFactory = connectionTypes.McpTransportFactory;

  type McpServerLog = logTypes.McpServerLog;

  type McpOAuthCredentialStore = oauthTypesNs.McpOAuthCredentialStore;

  type McpSignInCancelledError = oauthTypesNs.McpSignInCancelledError;
}

export type { runtimeTypes as default };
