import type memoryStoreTypes from "../memory-store.types.ts";
import type providerTypesModule from "../provider-types.ts";
import type providerTypes from "../provider.types.ts";
import type typesModule from "../types.types.ts";

declare namespace oauthProviderKitTypes {
  type McpOAuthProviderOptions = providerTypesModule.McpOAuthProviderOptions;
  type McpOAuthState = providerTypesModule.McpOAuthState;
  type McpOAuthStateStore = providerTypesModule.McpOAuthStateStore;
  type AuthorizationServerMetadata = typesModule.AuthorizationServerMetadata;
  type OAuthChallenge = typesModule.OAuthChallenge;
  type OAuthClientInformation = typesModule.OAuthClientInformation;
  type OAuthClientInformationFull = typesModule.OAuthClientInformationFull;
  type OAuthClientInformationMixed = typesModule.OAuthClientInformationMixed;
  type OAuthClientMetadata = typesModule.OAuthClientMetadata;
  type OAuthDiscoveryState = typesModule.OAuthDiscoveryState;
  type OAuthProtectedResourceMetadata = typesModule.OAuthProtectedResourceMetadata;
  type OAuthServerInfo = typesModule.OAuthServerInfo;
  type OAuthTokens = typesModule.OAuthTokens;
  type McpOAuthProvider = providerTypes.McpOAuthProvider;
  type MemoryOAuthStateStore = memoryStoreTypes.MemoryOAuthStateStore;
}

export type { oauthProviderKitTypes as default };
