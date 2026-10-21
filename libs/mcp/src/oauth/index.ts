import OAuthInsecureEndpointError from "./errors/insecure-endpoint-error.ts";
import OAuthIssuerMismatchError from "./errors/issuer-mismatch-error.ts";
import OAuthError from "./errors/oauth-error.ts";
import OAuthRegistrationError from "./errors/registration-error.ts";
import flow from "./flow.ts";
import indexKit from "./index-kit.ts";
import MemoryOAuthStateStore from "./memory-store.ts";
import provider from "./provider.ts";
import resourceModule from "./resource.ts";
import token from "./token.ts";

const {
  adapter,
  authorization,
  McpOAuthAuthorizationRequiredError,
  OAuthCallbackServer,
  OAuthCallbackError,
  discovery,
  OAuthFlowError,
} = indexKit;

const oauth = {
  McpOAuthAuthorizationRequiredError: McpOAuthAuthorizationRequiredError,
  McpOAuthProvider: provider.McpOAuthProvider,
  MemoryOAuthStateStore: MemoryOAuthStateStore,
  OAuthCallbackError: OAuthCallbackError,
  OAuthCallbackServer: OAuthCallbackServer,
  OAuthError: OAuthError,
  OAuthFlowError: OAuthFlowError,
  OAuthInsecureEndpointError: OAuthInsecureEndpointError,
  OAuthIssuerMismatchError: OAuthIssuerMismatchError,
  OAuthRegistrationError: OAuthRegistrationError,
  adaptOAuthProvider: adapter.adaptOAuthProvider,
  authorizeMcp: flow.authorizeMcp,
  buildAuthorizationServerDiscoveryUrls: discovery.buildAuthorizationServerDiscoveryUrls,
  discoverAuthorizationServerMetadata: discovery.discoverAuthorizationServerMetadata,
  discoverOAuthServerInfo: discovery.discoverOAuthServerInfo,
  discoverProtectedResourceMetadata: discovery.discoverProtectedResourceMetadata,
  exchangeAuthorizationCode: token.exchangeAuthorizationCode,
  parseWwwAuthenticate: discovery.parseWwwAuthenticate,
  refreshAuthorization: token.refreshAuthorization,
  registerClient: authorization.registerClient,
  resourceUrlFromServerUrl: resourceModule.resourceUrlFromServerUrl,
  selectResource: resourceModule.selectResource,
  startAuthorization: authorization.startAuthorization,
  stepUpScope: flow.stepUpScope,
};

export default oauth;
