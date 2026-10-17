import { Effect, Schema } from "effect";
import { dual } from "effect/Function";

import type { McpFetch } from "../auth-provider.ts";
import { foreign, fromPromise, fromSync, type McpForeignError } from "../foreign.ts";
import { applicationType, present } from "./endpoint.ts";
import { OAuthFlowError, OAuthRegistrationError } from "./errors.ts";
import {
  type AuthorizationServerMetadata,
  type OAuthClientInformationFull,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  parseClientInformation,
} from "./types.ts";

export interface AuthorizationRequest {
  metadata?: AuthorizationServerMetadata | undefined;
  clientInformation: OAuthClientInformationMixed;
  redirectUrl: string | URL;
  scope?: string | undefined;
  state?: string | undefined;
  resource?: string | undefined;
}

export interface ClientRegistrationRequest {
  metadata?: AuthorizationServerMetadata | undefined;
  clientMetadata: OAuthClientMetadata;
  scope?: string | undefined;
  fetch?: McpFetch | undefined;
  signal?: AbortSignal | undefined;
}

export interface AuthorizationStart {
  authorizationUrl: URL;
  codeVerifier: string;
}

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const pkce = Effect.fn("pkce")(function* () {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = Buffer.from(bytes).toString("base64url");
  const digest = yield* fromPromise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return { verifier, challenge: Buffer.from(digest).toString("base64url") };
});

const startAuthorizationEffect = Effect.fn("startAuthorization")(function* (
  authorizationServerUrl: string | URL,
  options: AuthorizationRequest,
) {
  const metadata = options.metadata;
  if (metadata !== undefined && !metadata.response_types_supported.includes("code"))
    return yield* new OAuthFlowError("Authorization server does not support authorization codes");
  const challengeMethods = metadata?.code_challenge_methods_supported;
  if (challengeMethods !== undefined && !challengeMethods.includes("S256"))
    return yield* new OAuthFlowError("Authorization server does not support PKCE S256");
  const url = new URL(
    metadata?.authorization_endpoint ?? new URL("/authorize", authorizationServerUrl),
  );
  const { verifier, challenge } = yield* pkce();
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", options.clientInformation.client_id);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", String(options.redirectUrl));
  if (present(options.state)) url.searchParams.set("state", options.state);
  if (present(options.scope)) url.searchParams.set("scope", options.scope);
  if (options.scope?.split(/\s+/u).includes("offline_access") === true)
    url.searchParams.set("prompt", "consent");
  if (present(options.resource)) url.searchParams.set("resource", options.resource);
  const start: AuthorizationStart = { authorizationUrl: url, codeVerifier: verifier };
  return start;
});

export const startAuthorization: {
  (
    options: AuthorizationRequest,
  ): (
    authorizationServerUrl: string | URL,
  ) => Effect.Effect<AuthorizationStart, McpForeignError | OAuthFlowError>;
  (
    authorizationServerUrl: string | URL,
    options: AuthorizationRequest,
  ): Effect.Effect<AuthorizationStart, McpForeignError | OAuthFlowError>;
} = dual(2, startAuthorizationEffect);

const registerClientEffect = Effect.fn("registerClient")(function* (
  authorizationServerUrl: string | URL,
  options: ClientRegistrationRequest,
) {
  const endpoint = options.metadata?.registration_endpoint;
  if (options.metadata !== undefined && !present(endpoint))
    return yield* new OAuthFlowError(
      "Authorization server does not support dynamic client registration",
    );
  const fetch = options.fetch ?? globalThis.fetch;
  const body = yield* encodeJson({
    ...options.clientMetadata,
    application_type:
      options.clientMetadata.application_type ??
      applicationType(options.clientMetadata.redirect_uris),
    ...(present(options.scope) ? { scope: options.scope } : {}),
  }).pipe(Effect.mapError(foreign));
  const response = yield* fromPromise(() =>
    fetch(new URL(endpoint ?? new URL("/register", authorizationServerUrl)), {
      method: "POST",
      headers: { Accept: "application/json", "content-type": "application/json" },
      body,
      signal: options.signal ?? null,
    }),
  );
  if (!response.ok) {
    const text = yield* fromPromise(() => response.text());
    return yield* new OAuthRegistrationError(response.status, text);
  }
  const value = yield* fromPromise((): Promise<unknown> => response.json());
  return yield* fromSync(() => parseClientInformation(value));
});

export const registerClient: {
  (
    options: ClientRegistrationRequest,
  ): (
    authorizationServerUrl: string | URL,
  ) => Effect.Effect<
    OAuthClientInformationFull,
    McpForeignError | OAuthFlowError | OAuthRegistrationError
  >;
  (
    authorizationServerUrl: string | URL,
    options: ClientRegistrationRequest,
  ): Effect.Effect<
    OAuthClientInformationFull,
    McpForeignError | OAuthFlowError | OAuthRegistrationError
  >;
} = dual(2, registerClientEffect);
