import { Effect, type Schema } from "effect";
import { dual } from "effect/Function";

import { McpForeignError } from "../src/index.ts";
import type {
  OAuthClientInformationMixed,
  OAuthClientProvider,
  OAuthDiscoveryState,
  OAuthTokens,
} from "../src/oauth/index.ts";
import helpers from "./helpers.ts";
import MissingVerifierError from "./missing-verifier-error.ts";

const { encodeJson } = helpers;

class TestOAuthProvider implements OAuthClientProvider {
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
      client_name: "msa-mcp-test",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: [redirectUrl],
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

const sendJson: {
  (value: unknown): (status: number) => Effect.Effect<Response, Schema.SchemaError>;
  (status: number, value: unknown): Effect.Effect<Response, Schema.SchemaError>;
} = dual(2, (status: number, value: unknown) =>
  encodeJson(value).pipe(
    Effect.map(
      (body) => new Response(body, { headers: { "content-type": "application/json" }, status }),
    ),
  ),
);

const endWith = (status: number): Effect.Effect<Response> =>
  Effect.succeed(new Response(null, { status }));

const authorizationServerMetadata = (origin: string) => ({
  authorization_endpoint: `${origin}/authorize`,
  issuer: origin,
  response_types_supported: ["code"],
  token_endpoint: `${origin}/token`,
});

const originalError = (error: unknown): unknown =>
  error instanceof McpForeignError ? error.cause : error;

const oauthSupport = {
  TestOAuthProvider,
  authorizationServerMetadata,
  endWith,
  originalError,
  sendJson,
};

export default oauthSupport;
