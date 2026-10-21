import { Clock, Effect, Function } from "effect";

import http from "../../utils/http.ts";
import type typesModule from "../types.ts";
import type openaiChatgptTokenTypes from "./openai-chatgpt-token.types.ts";

const { httpRequest } = http;

const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE = "https://api.openai.com/v1";
const DIRECT_TOKEN_SCOPE = "chatgpt.tokens.use.direct";
const EXPIRY_MARGIN_MS = 3 * 60 * 1000;

interface TokenResponse {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
  readonly id_token?: unknown;
  readonly scope?: unknown;
}

const requestToken = (body: URLSearchParams, signal: AbortSignal): Effect.Effect<TokenResponse> =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      body: body.toString(),
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
      signal,
      url: TOKEN_URL,
    });
    if (!reply.ok) {
      const responseBody = yield* reply.text.pipe(Effect.catchDefect(() => Effect.succeed("")));
      return yield* Effect.die(
        new Error(`OpenAI OAuth token request failed (${reply.status}): ${responseBody}`),
      );
    }
    const data = yield* reply.json;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return yield* Effect.die(new Error("OpenAI OAuth token response must be an object"));
    }
    return data as TokenResponse;
  });

const requireTokenString = (
  value: unknown,
  field: "access_token" | "refresh_token" | "scope",
): Effect.Effect<string> =>
  typeof value === "string" && value.trim().length > 0
    ? Effect.succeed(value)
    : Effect.die(new Error(`OpenAI OAuth token response has invalid ${field}`));

const credentialFromTokenResponse = (
  token: TokenResponse,
  clientId: string,
): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    const access = yield* requireTokenString(token.access_token, "access_token");
    const refresh = yield* requireTokenString(token.refresh_token, "refresh_token");
    const scope = yield* requireTokenString(token.scope, "scope");
    const expiresIn = token.expires_in;
    if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      return yield* Effect.die(new Error("OpenAI OAuth token response has invalid expires_in"));
    }
    const scopes = scope
      .trim()
      .split(/\s+/u)
      .filter((entry) => entry !== "");
    if (!scopes.includes(DIRECT_TOKEN_SCOPE)) {
      return yield* Effect.die(
        new Error(`OpenAI OAuth grant did not include ${DIRECT_TOKEN_SCOPE}`),
      );
    }
    const now = yield* Clock.currentTimeMillis;
    return {
      access,
      clientId,
      expires: now + expiresIn * 1000 - EXPIRY_MARGIN_MS,
      refresh,
      scopes,
      type: "oauth",
    };
  });

const exchangeAuthorizationCode = ({
  code,
  verifier,
  clientId,
  redirectUri,
  signal,
}: openaiChatgptTokenTypes.ChatGPTCodeExchange): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    const token = yield* requestToken(
      new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        resource: RESOURCE,
      }),
      signal,
    );
    if (typeof token.id_token !== "string" || token.id_token.trim().length === 0) {
      return yield* Effect.die(
        new Error("OpenAI OAuth token response did not contain an ID token"),
      );
    }
    return yield* credentialFromTokenResponse(token, clientId);
  });

const refresh = (
  credential: typesModule.OAuthCredential,
  signal: AbortSignal,
): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    const clientId = credential["clientId"];
    if (typeof clientId !== "string" || clientId.trim().length === 0) {
      return yield* Effect.die(
        new Error(
          "Stored OpenAI OAuth credential does not contain an issued client ID; reconnect ChatGPT",
        ),
      );
    }
    const token = yield* requestToken(
      new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: credential.refresh,
        resource: RESOURCE,
      }),
      signal,
    );
    return yield* credentialFromTokenResponse(token, clientId);
  });

const refreshAccessToken: {
  (
    signal: AbortSignal,
  ): (credential: typesModule.OAuthCredential) => Effect.Effect<typesModule.OAuthCredential>;
  (
    credential: typesModule.OAuthCredential,
    signal: AbortSignal,
  ): Effect.Effect<typesModule.OAuthCredential>;
} = Function.dual(2, refresh);

const openaiChatgptToken = {
  DIRECT_TOKEN_SCOPE,
  RESOURCE,
  exchangeAuthorizationCode,
  refreshAccessToken,
};

export default openaiChatgptToken;
