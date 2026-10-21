import type authProviderTypes from "../auth-provider.ts";
import type clientCoreTypes from "../client-core.types.ts";
import type clientTypes from "../client.types.ts";
import type foreignTypes from "../foreign.types.ts";

declare namespace mcpClientKitTypes {
  type AuthProvider = authProviderTypes.AuthProvider;
  type McpFetch = authProviderTypes.McpFetch;
  type UnauthorizedContext = authProviderTypes.UnauthorizedContext;
  type McpClientOptions = clientTypes.McpClientOptions;
  type McpRequestOptions = clientCoreTypes.McpRequestOptions;
  type McpClient = clientTypes.McpClient;
  type McpForeignError = foreignTypes.McpForeignError;
}

export type { mcpClientKitTypes as default };
