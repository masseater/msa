import type flowTypesModule from "./flow-types.ts";
import type typesModule from "./types.types.ts";

declare namespace providerTypesModule {
  interface McpOAuthState {
    serverUrl: string;
    clientInformation?: typesModule.OAuthClientInformationMixed;
    tokens?: typesModule.OAuthTokens;
    tokensExpireAt?: number;
    codeVerifier?: string;
    oauthState?: string;
    discovery?: typesModule.OAuthDiscoveryState;
  }

  interface McpOAuthStateStore {
    load(): McpOAuthState | undefined | Promise<McpOAuthState | undefined>;
    save(state: McpOAuthState): void | Promise<void>;
  }

  interface McpOAuthProviderOptions {
    serverUrl: string | URL;
    redirectUrl: string | URL;
    clientMetadata: Omit<typesModule.OAuthClientMetadata, "redirect_uris"> & {
      redirect_uris?: string[];
    };
    clientMetadataDocument?: (
      metadata: typesModule.AuthorizationServerMetadata | undefined,
    ) => flowTypesModule.OAuthClientMetadataDocument | undefined;
    clientId?: string;
    clientSecret?: string;
    store?: McpOAuthStateStore;
    onRedirect(url: URL): void | Promise<void>;
  }
}

export type { providerTypesModule as default };
