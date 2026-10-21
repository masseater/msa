import type authProviderTypes from "../auth-provider.ts";

declare namespace discoveryTypes {
  interface ProtectedResourceDiscoveryOptions {
    resourceMetadataUrl?: string | URL | undefined;
    protocolVersion?: string | undefined;
    fetch?: authProviderTypes.McpFetch | undefined;
    signal?: AbortSignal | undefined;
  }

  interface AuthorizationServerDiscoveryOptions {
    fetch?: authProviderTypes.McpFetch | undefined;
    protocolVersion?: string | undefined;
    skipIssuerValidation?: boolean | undefined;
    signal?: AbortSignal | undefined;
  }

  interface OAuthServerInfoDiscoveryOptions {
    resourceMetadataUrl?: URL | undefined;
    authorizationServerMetadataUrl?: URL | undefined;
    fetch?: authProviderTypes.McpFetch | undefined;
    skipIssuerValidation?: boolean | undefined;
    signal?: AbortSignal | undefined;
  }
}

export type { discoveryTypes as default };
