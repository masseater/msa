import { Effect, Option, Schema } from "effect";
import { dual } from "effect/Function";

import endpoint from "./endpoint.ts";
import errors from "./errors.ts";
import type errorsTypes from "./errors.types.ts";
import type flowTypesModule from "./flow-types.ts";
import tokenKit from "./token-kit.ts";
import type tokenTypes from "./token.types.ts";
import types from "./types.ts";
import type typesModule from "./types.types.ts";

const { foreign: foreignModule, jsonrpc: jsonrpcModule } = tokenKit;

const { present, secureEndpoint } = endpoint;
const { OAuthError, OAuthFlowError } = errors;
const { isObject } = jsonrpcModule;
const { fromPromise, fromSync } = foreignModule;
const { parseOAuthTokens } = types;

const CLIENT_AUTH_METHODS: readonly string[] = [
  "client_secret_basic",
  "client_secret_post",
  "none",
];

const isClientAuthMethod = (value: string): value is flowTypesModule.ClientAuthMethod =>
  CLIENT_AUTH_METHODS.includes(value);

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function selectClientAuthMethod(
  information: typesModule.OAuthClientInformationMixed,
  supported: string[],
): flowTypesModule.ClientAuthMethod {
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
  method: flowTypesModule.ClientAuthMethod,
  information: typesModule.OAuthClientInformation,
  headers: Headers,
  params: URLSearchParams,
): Effect.Effect<void, errorsTypes.OAuthFlowError> =>
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

const tokenError = (value: unknown): errorsTypes.OAuthError | undefined => {
  if (!isObject(value) || typeof value["error"] !== "string") return undefined;
  return new OAuthError(
    value["error"],
    typeof value["error_description"] === "string" ? value["error_description"] : value["error"],
    typeof value["error_uri"] === "string" ? value["error_uri"] : undefined,
  );
};

const tokenRequest = Effect.fn("tokenRequest")(function* (
  authorizationServerUrl: string | URL,
  options: flowTypesModule.TokenRequestOptions,
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
    fetch(url, { body: params, headers, method: "POST", signal: options.signal ?? null }),
  );
  const text = yield* fromPromise(() => response.text());
  const value = Option.getOrUndefined(decodeJson(text));
  const error = tokenError(value);
  if (error !== undefined) return yield* error;
  if (!response.ok)
    return yield* new OAuthError("server_error", `HTTP ${response.status}: ${text}`);
  return yield* fromSync(() => parseOAuthTokens(value));
});

const exchangeAuthorizationCode: {
  (
    options: tokenTypes.AuthorizationCodeExchange,
  ): (
    authorizationServerUrl: string | URL,
  ) => Effect.Effect<typesModule.OAuthTokens, tokenTypes.TokenRequestError>;
  (
    authorizationServerUrl: string | URL,
    options: tokenTypes.AuthorizationCodeExchange,
  ): Effect.Effect<typesModule.OAuthTokens, tokenTypes.TokenRequestError>;
} = dual(2, (authorizationServerUrl: string | URL, options: tokenTypes.AuthorizationCodeExchange) =>
  tokenRequest(
    authorizationServerUrl,
    options,
    new URLSearchParams({
      code: options.code,
      code_verifier: options.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: String(options.redirectUrl),
    }),
  ),
);

const refreshAuthorization: {
  (
    options: tokenTypes.RefreshRequest,
  ): (
    authorizationServerUrl: string | URL,
  ) => Effect.Effect<typesModule.OAuthTokens, tokenTypes.TokenRequestError>;
  (
    authorizationServerUrl: string | URL,
    options: tokenTypes.RefreshRequest,
  ): Effect.Effect<typesModule.OAuthTokens, tokenTypes.TokenRequestError>;
} = dual(2, (authorizationServerUrl: string | URL, options: tokenTypes.RefreshRequest) =>
  tokenRequest(
    authorizationServerUrl,
    options,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: options.refreshToken }),
  ).pipe(
    Effect.map((tokens): typesModule.OAuthTokens =>
      Object.assign({ refresh_token: options.refreshToken }, tokens),
    ),
  ),
);

const token = {
  exchangeAuthorizationCode,
  refreshAuthorization,
};

export default token;
