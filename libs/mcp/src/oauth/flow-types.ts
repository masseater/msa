import type authProviderTypes from "../auth-provider.ts";
import type typesModule from "./types.types.ts";

declare namespace flowTypesModule {
  type AddClientAuthentication = (
    headers: Headers,
    params: URLSearchParams,
    url: string | URL,
    metadata?: typesModule.AuthorizationServerMetadata,
  ) => void | Promise<void>;

  interface OAuthClientMetadataDocument {
    url: string;
    redirectUrl: string;
  }

  interface OAuthClientProvider {
    readonly redirectUrl: string | URL;
    readonly clientMetadata: typesModule.OAuthClientMetadata;
    clientMetadataDocument?(
      metadata: typesModule.AuthorizationServerMetadata | undefined,
    ): OAuthClientMetadataDocument | undefined;
    state?(): string | Promise<string>;
    clientInformation():
      | typesModule.OAuthClientInformationMixed
      | undefined
      | Promise<typesModule.OAuthClientInformationMixed | undefined>;
    saveClientInformation?(
      information: typesModule.OAuthClientInformationMixed,
    ): void | Promise<void>;
    tokens(): typesModule.OAuthTokens | undefined | Promise<typesModule.OAuthTokens | undefined>;
    saveTokens(tokens: typesModule.OAuthTokens): void | Promise<void>;
    redirectToAuthorization(url: URL): void | Promise<void>;
    saveCodeVerifier(verifier: string): void | Promise<void>;
    codeVerifier(): string | Promise<string>;
    addClientAuthentication?: AddClientAuthentication;
    invalidateCredentials?(
      kind: "all" | "client" | "tokens" | "verifier" | "discovery",
    ): void | Promise<void>;
    saveDiscoveryState?(state: typesModule.OAuthDiscoveryState): void | Promise<void>;
    discoveryState?():
      | typesModule.OAuthDiscoveryState
      | undefined
      | Promise<typesModule.OAuthDiscoveryState | undefined>;
  }

  interface OAuthFlowOptions {
    serverUrl: string | URL;
    authorizationCode?: string | undefined;
    iss?: string | undefined;
    scope?: string | undefined;
    resourceMetadataUrl?: URL | undefined;
    authorizationServerMetadataUrl?: URL | undefined;
    fetch?: authProviderTypes.McpFetch | undefined;
    signal?: AbortSignal | undefined;
    skipIssuerValidation?: boolean | undefined;
    skipRefresh?: boolean | undefined;
  }

  type OAuthFlowResult = "AUTHORIZED" | "REDIRECT";

  type ClientAuthMethod = "client_secret_basic" | "client_secret_post" | "none";

  interface TokenRequestOptions {
    metadata?: typesModule.AuthorizationServerMetadata | undefined;
    clientInformation: typesModule.OAuthClientInformationMixed;
    resource?: string | undefined;
    addClientAuthentication?: AddClientAuthentication | undefined;
    fetch?: authProviderTypes.McpFetch | undefined;
    signal?: AbortSignal | undefined;
  }
}

export type { flowTypesModule as default };
