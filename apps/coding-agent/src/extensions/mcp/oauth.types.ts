import type mcpTypes from "@msa/mcp/index.types";
import type oauthTypes from "@msa/mcp/oauth.types";

import type McpOAuthCredentialStoreClass from "./mcp-oauth-credential-store.ts";
import type signInCancelledTypes from "./sign-in-cancelled.types.ts";

declare namespace oauthTypesNs {
  interface McpOAuthSettings {
    clientId?: string | undefined;

    clientSecret?: string | undefined;
    callbackPort?: number | undefined;

    callbackUrl?: string | undefined;

    scope?: string | undefined;

    clientName?: string | undefined;

    clientRegistration?: "dcr" | "cimd" | undefined;

    authServerMetadataUrl?: URL | undefined;
  }

  interface McpOAuthServerStore extends oauthTypes.McpOAuthStateStore {
    withRefreshLock<T>(fn: () => Promise<T>): Promise<T>;
  }

  interface McpAuthProvider extends mcpTypes.AuthProvider {
    settled(): Promise<void>;
  }

  interface McpSignInPrompt {
    showAuthorizationUrl(url: URL): void;

    promptForRedirectUrl(signal: AbortSignal): Promise<string | undefined>;
  }

  type McpOAuthCredentialStore = (typeof McpOAuthCredentialStoreClass)["prototype"];

  type McpSignInCancelledError = signInCancelledTypes.McpSignInCancelledError;
}

export type { oauthTypesNs as default };
