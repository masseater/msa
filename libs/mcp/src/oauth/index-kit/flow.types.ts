import type authorizationTypes from "../authorization.types.ts";
import type callbackTypes from "../callback.types.ts";
import type discoveryTypes from "../discovery.types.ts";
import type flowTypesModule from "../flow-types.ts";
import type flowTypes from "../flow.types.ts";
import type tokenTypes from "../token.types.ts";

declare namespace oauthFlowKitTypes {
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
  type OAuthCallbackServer = callbackTypes.OAuthCallbackServer;
}

export type { oauthFlowKitTypes as default };
