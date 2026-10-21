import type oauthTypes from "@msa/mcp/oauth.types";

import type oauthTypesNs from "./oauth.types.ts";
import McpTokenRefresh from "./oauth/auth-provider.ts";
import signIn from "./oauth/sign-in.ts";

const { signInMcpServer } = signIn;

function createMcpAuthProvider(options: {
  serverUrl: string;
  store: oauthTypesNs.McpOAuthServerStore;
  settings: () => oauthTypesNs.McpOAuthSettings;
  onChallenge: (challenge: oauthTypes.OAuthChallenge) => void;
}): oauthTypesNs.McpAuthProvider {
  return new McpTokenRefresh(options);
}

const oauthModule = {
  createMcpAuthProvider,
  signInMcpServer,
};

export default oauthModule;
