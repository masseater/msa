import type { OAuthClientMetadataDocument } from "./flow-types.ts";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthDiscoveryState,
  OAuthTokens,
} from "./types.ts";

export interface McpOAuthState {
  serverUrl: string;
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  tokensExpireAt?: number;
  codeVerifier?: string;
  oauthState?: string;
  discovery?: OAuthDiscoveryState;
}

export interface McpOAuthStateStore {
  load(): McpOAuthState | undefined | Promise<McpOAuthState | undefined>;
  save(state: McpOAuthState): void | Promise<void>;
}

export interface McpOAuthProviderOptions {
  serverUrl: string | URL;
  redirectUrl: string | URL;
  clientMetadata: Omit<OAuthClientMetadata, "redirect_uris"> & { redirect_uris?: string[] };
  clientMetadataDocument?: (
    metadata: AuthorizationServerMetadata | undefined,
  ) => OAuthClientMetadataDocument | undefined;
  clientId?: string;
  clientSecret?: string;
  store?: McpOAuthStateStore;
  onRedirect(url: URL): void | Promise<void>;
}
