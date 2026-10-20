import type authorizationTypes from "./authorization.types.ts";
import type callbackTypes from "./callback.types.ts";
import type discoveryTypes from "./discovery.types.ts";
import type flowTypesModule from "./flow-types.ts";
import type flowTypes from "./flow.types.ts";
import type providerTypesModule from "./provider-types.ts";
import type tokenTypes from "./token.types.ts";
import type typesModule from "./types.types.ts";

declare namespace oauthTypesPart1 {
  type OAuthCallback = callbackTypes.OAuthCallback;
  type OAuthCallbackPage = callbackTypes.OAuthCallbackPage;
  type OAuthCallbackServerOptions = callbackTypes.OAuthCallbackServerOptions;
  type AuthorizationServerDiscoveryOptions = discoveryTypes.AuthorizationServerDiscoveryOptions;
  type OAuthServerInfoDiscoveryOptions = discoveryTypes.OAuthServerInfoDiscoveryOptions;
  type ProtectedResourceDiscoveryOptions = discoveryTypes.ProtectedResourceDiscoveryOptions;
  type AuthorizationRequest = authorizationTypes.AuthorizationRequest;
  type AuthorizationStart = authorizationTypes.AuthorizationStart;
  type ClientRegistrationRequest = authorizationTypes.ClientRegistrationRequest;
  type OAuthFlowFailure = flowTypes.OAuthFlowFailure;
  type AddClientAuthentication = flowTypesModule.AddClientAuthentication;
  type OAuthClientMetadataDocument = flowTypesModule.OAuthClientMetadataDocument;
  type OAuthClientProvider = flowTypesModule.OAuthClientProvider;
  type OAuthFlowOptions = flowTypesModule.OAuthFlowOptions;
  type OAuthFlowResult = flowTypesModule.OAuthFlowResult;
  type TokenRequestOptions = flowTypesModule.TokenRequestOptions;
  type AuthorizationCodeExchange = tokenTypes.AuthorizationCodeExchange;
  type RefreshRequest = tokenTypes.RefreshRequest;
  type TokenRequestError = tokenTypes.TokenRequestError;
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
  type OAuthCallbackServer = callbackTypes.OAuthCallbackServer;
}

export type { oauthTypesPart1 as default };
