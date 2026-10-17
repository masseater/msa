import { Effect, Option, Schema } from "effect";
import { dual } from "effect/Function";

import { fromPromise, fromSync, type McpForeignError } from "../foreign.ts";
import { isObject } from "../protocol/jsonrpc.ts";
import { present, secureEndpoint } from "./endpoint.ts";
import { OAuthError, OAuthFlowError, type OAuthInsecureEndpointError } from "./errors.ts";
import type { ClientAuthMethod, TokenRequestOptions } from "./flow-types.ts";
import {
  type OAuthClientInformation,
  type OAuthClientInformationMixed,
  type OAuthTokens,
  parseOAuthTokens,
} from "./types.ts";

export type TokenRequestError =
  | McpForeignError
  | OAuthError
  | OAuthFlowError
  | OAuthInsecureEndpointError;

const CLIENT_AUTH_METHODS: readonly string[] = [
  "client_secret_basic",
  "client_secret_post",
  "none",
];

const isClientAuthMethod = (value: string): value is ClientAuthMethod =>
  CLIENT_AUTH_METHODS.includes(value);

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function selectClientAuthMethod(
  information: OAuthClientInformationMixed,
  supported: string[],
): ClientAuthMethod {
  const hinted =
    "token_endpoint_auth_method" in information
      ? information.token_endpoint_auth_method
      : undefined;
  if (
    present(hinted) &&
    isClientAuthMethod(hinted) &&
    (supported.length === 0 || supported.includes(hinted))
  ) {
    return hinted;
  }
  const hasSecret = present(information.client_secret);
  if (supported.length === 0) return hasSecret ? "client_secret_basic" : "none";
  if (hasSecret && supported.includes("client_secret_basic")) return "client_secret_basic";
  if (hasSecret && supported.includes("client_secret_post")) return "client_secret_post";
  if (supported.includes("none")) return "none";
  return hasSecret ? "client_secret_post" : "none";
}

const applyClientAuthentication = (
  method: ClientAuthMethod,
  information: OAuthClientInformation,
  headers: Headers,
  params: URLSearchParams,
): Effect.Effect<void, OAuthFlowError> =>
  Effect.suspend(() => {
    const secret = information.client_secret;
    if (method === "client_secret_basic") {
      if (!present(secret))
        return Effect.fail(new OAuthFlowError("client_secret_basic requires a client secret"));
      headers.set(
        "Authorization",
        `Basic ${Buffer.from(`${information.client_id}:${secret}`).toString("base64")}`,
      );
      return Effect.void;
    }
    params.set("client_id", information.client_id);
    if (method === "client_secret_post" && present(secret)) params.set("client_secret", secret);
    return Effect.void;
  });

const tokenError = (value: unknown): OAuthError | undefined => {
  if (!isObject(value) || typeof value["error"] !== "string") return undefined;
  return new OAuthError(
    value["error"],
    typeof value["error_description"] === "string" ? value["error_description"] : value["error"],
    typeof value["error_uri"] === "string" ? value["error_uri"] : undefined,
  );
};

const tokenRequest = Effect.fn("tokenRequest")(function* (
  authorizationServerUrl: string | URL,
  options: TokenRequestOptions,
  params: URLSearchParams,
) {
  const url = yield* secureEndpoint(
    options.metadata?.token_endpoint ?? new URL("/token", authorizationServerUrl),
  );
  const headers = new Headers({
    Accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  });
  if (present(options.resource)) params.set("resource", options.resource);
  const addClientAuthentication = options.addClientAuthentication;
  if (addClientAuthentication === undefined) {
    yield* applyClientAuthentication(
      selectClientAuthMethod(
        options.clientInformation,
        options.metadata?.token_endpoint_auth_methods_supported ?? [],
      ),
      options.clientInformation,
      headers,
      params,
    );
  } else {
    yield* fromPromise(() => addClientAuthentication(headers, params, url, options.metadata));
  }
  const fetch = options.fetch ?? globalThis.fetch;
  const response = yield* fromPromise(() =>
    fetch(url, { method: "POST", headers, body: params, signal: options.signal ?? null }),
  );
  const text = yield* fromPromise(() => response.text());
  const value = Option.getOrUndefined(decodeJson(text));
  const error = tokenError(value);
  if (error !== undefined) return yield* error;
  if (!response.ok)
    return yield* new OAuthError("server_error", `HTTP ${response.status}: ${text}`);
  return yield* fromSync(() => parseOAuthTokens(value));
});

export interface AuthorizationCodeExchange extends TokenRequestOptions {
  code: string;
  codeVerifier: string;
  redirectUrl: string | URL;
}

export const exchangeAuthorizationCode: {
  (
    options: AuthorizationCodeExchange,
  ): (authorizationServerUrl: string | URL) => Effect.Effect<OAuthTokens, TokenRequestError>;
  (
    authorizationServerUrl: string | URL,
    options: AuthorizationCodeExchange,
  ): Effect.Effect<OAuthTokens, TokenRequestError>;
} = dual(2, (authorizationServerUrl: string | URL, options: AuthorizationCodeExchange) =>
  tokenRequest(
    authorizationServerUrl,
    options,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: options.code,
      code_verifier: options.codeVerifier,
      redirect_uri: String(options.redirectUrl),
    }),
  ),
);

export interface RefreshRequest extends TokenRequestOptions {
  refreshToken: string;
}

export const refreshAuthorization: {
  (
    options: RefreshRequest,
  ): (authorizationServerUrl: string | URL) => Effect.Effect<OAuthTokens, TokenRequestError>;
  (
    authorizationServerUrl: string | URL,
    options: RefreshRequest,
  ): Effect.Effect<OAuthTokens, TokenRequestError>;
} = dual(2, (authorizationServerUrl: string | URL, options: RefreshRequest) =>
  tokenRequest(
    authorizationServerUrl,
    options,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: options.refreshToken }),
  ).pipe(
    Effect.map((tokens): OAuthTokens =>
      Object.assign({ refresh_token: options.refreshToken }, tokens),
    ),
  ),
);
