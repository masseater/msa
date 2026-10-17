import type { McpFetch } from "../auth-provider.ts";
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthDiscoveryState,
  OAuthTokens,
} from "./types.ts";

export type AddClientAuthentication = (
  headers: Headers,
  params: URLSearchParams,
  url: string | URL,
  metadata?: AuthorizationServerMetadata,
) => void | Promise<void>;

export interface OAuthClientMetadataDocument {
  url: string;
  redirectUrl: string;
}

export interface OAuthClientProvider {
  readonly redirectUrl: string | URL;
  readonly clientMetadata: OAuthClientMetadata;
  clientMetadataDocument?(
    metadata: AuthorizationServerMetadata | undefined,
  ): OAuthClientMetadataDocument | undefined;
  state?(): string | Promise<string>;
  clientInformation():
    | OAuthClientInformationMixed
    | undefined
    | Promise<OAuthClientInformationMixed | undefined>;
  saveClientInformation?(information: OAuthClientInformationMixed): void | Promise<void>;
  tokens(): OAuthTokens | undefined | Promise<OAuthTokens | undefined>;
  saveTokens(tokens: OAuthTokens): void | Promise<void>;
  redirectToAuthorization(url: URL): void | Promise<void>;
  saveCodeVerifier(verifier: string): void | Promise<void>;
  codeVerifier(): string | Promise<string>;
  addClientAuthentication?: AddClientAuthentication;
  invalidateCredentials?(
    kind: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): void | Promise<void>;
  saveDiscoveryState?(state: OAuthDiscoveryState): void | Promise<void>;
  discoveryState?(): OAuthDiscoveryState | undefined | Promise<OAuthDiscoveryState | undefined>;
}

export interface OAuthFlowOptions {
  serverUrl: string | URL;
  authorizationCode?: string | undefined;
  iss?: string | undefined;
  scope?: string | undefined;
  resourceMetadataUrl?: URL | undefined;
  authorizationServerMetadataUrl?: URL | undefined;
  fetch?: McpFetch | undefined;
  signal?: AbortSignal | undefined;
  skipIssuerValidation?: boolean | undefined;
  skipRefresh?: boolean | undefined;
}

export type OAuthFlowResult = "AUTHORIZED" | "REDIRECT";
export type ClientAuthMethod = "client_secret_basic" | "client_secret_post" | "none";

export interface TokenRequestOptions {
  metadata?: AuthorizationServerMetadata | undefined;
  clientInformation: OAuthClientInformationMixed;
  resource?: string | undefined;
  addClientAuthentication?: AddClientAuthentication | undefined;
  fetch?: McpFetch | undefined;
  signal?: AbortSignal | undefined;
}
