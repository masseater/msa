import { Clock, Effect, Function } from "effect";

import { httpRequest } from "../../utils/http.ts";
import type { OAuthCredential } from "../types.ts";

const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
export const RESOURCE = "https://api.openai.com/v1";
export const DIRECT_TOKEN_SCOPE = "chatgpt.tokens.use.direct";
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
      url: TOKEN_URL,
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
      signal,
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
): Effect.Effect<OAuthCredential> =>
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
      type: "oauth",
      access,
      refresh,
      expires: now + expiresIn * 1000 - EXPIRY_MARGIN_MS,
      clientId,
      scopes,
    };
  });

export interface ChatGPTCodeExchange {
  readonly code: string;
  readonly verifier: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly signal: AbortSignal;
}

export const exchangeAuthorizationCode = ({
  code,
  verifier,
  clientId,
  redirectUri,
  signal,
}: ChatGPTCodeExchange): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const token = yield* requestToken(
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
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
  credential: OAuthCredential,
  signal: AbortSignal,
): Effect.Effect<OAuthCredential> =>
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
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: credential.refresh,
        resource: RESOURCE,
      }),
      signal,
    );
    return yield* credentialFromTokenResponse(token, clientId);
  });

export const refreshAccessToken: {
  (signal: AbortSignal): (credential: OAuthCredential) => Effect.Effect<OAuthCredential>;
  (credential: OAuthCredential, signal: AbortSignal): Effect.Effect<OAuthCredential>;
} = Function.dual(2, refresh);
