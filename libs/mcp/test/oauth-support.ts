import { Effect, type Schema } from "effect";
import { dual } from "effect/Function";

import { McpForeignError } from "../src/index.ts";
import type {
  OAuthClientInformationMixed,
  OAuthClientProvider,
  OAuthDiscoveryState,
  OAuthTokens,
} from "../src/oauth/index.ts";
import { encodeJson } from "./helpers.ts";
import { MissingVerifierError } from "./missing-verifier-error.ts";

export class TestOAuthProvider implements OAuthClientProvider {
  readonly redirectUrl: string;
  readonly clientMetadata;
  client: OAuthClientInformationMixed | undefined;
  tokenSet: OAuthTokens | undefined;
  verifier: string | undefined;
  discovery: OAuthDiscoveryState | undefined;
  authorizationUrl: URL | undefined;

  constructor(redirectUrl: string) {
    this.redirectUrl = redirectUrl;
    this.clientMetadata = {
      redirect_uris: [redirectUrl],
      client_name: "msa-mcp-test",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    return "expected-state";
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.client;
  }

  saveClientInformation(information: OAuthClientInformationMixed): void {
    this.client = information;
  }

  tokens(): OAuthTokens | undefined {
    return this.tokenSet;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.tokenSet = tokens;
  }

  redirectToAuthorization(url: URL): void {
    this.authorizationUrl = url;
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    if (this.verifier === undefined || this.verifier === "")
      throw new MissingVerifierError({ message: "Missing code verifier" });
    return this.verifier;
  }

  invalidateCredentials(kind: "all" | "client" | "tokens" | "verifier" | "discovery"): void {
    if (kind === "all" || kind === "client") this.client = undefined;
    if (kind === "all" || kind === "tokens") this.tokenSet = undefined;
    if (kind === "all" || kind === "verifier") this.verifier = undefined;
    if (kind === "all" || kind === "discovery") this.discovery = undefined;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.discovery = state;
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.discovery;
  }
}

export const sendJson: {
  (value: unknown): (status: number) => Effect.Effect<Response, Schema.SchemaError>;
  (status: number, value: unknown): Effect.Effect<Response, Schema.SchemaError>;
} = dual(2, (status: number, value: unknown) =>
  encodeJson(value).pipe(
    Effect.map(
      (body) => new Response(body, { status, headers: { "content-type": "application/json" } }),
    ),
  ),
);

export const endWith = (status: number): Effect.Effect<Response> =>
  Effect.succeed(new Response(null, { status }));

export const authorizationServerMetadata = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/authorize`,
  token_endpoint: `${origin}/token`,
  response_types_supported: ["code"],
});

export const originalError = (error: unknown): unknown =>
  error instanceof McpForeignError ? error.cause : error;
