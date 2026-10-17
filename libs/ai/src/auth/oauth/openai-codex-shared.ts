import { Clock, Effect } from "effect";

import { type HttpReply, type HttpRequest, httpRequest } from "../../utils/http.ts";
import { decodeJson, encodeJson } from "../../utils/json-codec.ts";
import { getProviderEnvValue } from "../../utils/provider-env.ts";
import type { OAuthCredential } from "../types.ts";
import { readText } from "./response-json.ts";

const AUTH_BASE_URL = "https://auth.openai.com";

export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;
export const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
export const REDIRECT_URI = "http://localhost:1455/auth/callback";
export const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
export const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
export const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
export const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
export const DEVICE_CODE_TIMEOUT_SECONDS = 15 * 60;
export const BROWSER_LOGIN_METHOD = "browser";
export const DEVICE_CODE_LOGIN_METHOD = "device_code";
export const SCOPE = "openid profile email offline_access";

const JWT_CLAIM_PATH = "https://api.openai.com/auth";

export interface OAuthToken {
  readonly access: string;
  readonly refresh: string;
  readonly expires: number;
}

type TokenOperation = "exchange" | "refresh";

interface JwtPayload {
  readonly [JWT_CLAIM_PATH]?: {
    readonly chatgpt_account_id?: string;
  };
  readonly [key: string]: unknown;
}

export const getCallbackHost = (): string =>
  getProviderEnvValue("MSA_OAUTH_CALLBACK_HOST") ?? "127.0.0.1";

export const requestWithLoginCancellation = (request: HttpRequest): Effect.Effect<HttpReply> =>
  httpRequest(request).pipe(
    Effect.catchDefect((error) =>
      Effect.die(
        request.signal?.aborted === true
          ? new Error("Login cancelled", { cause: error })
          : (error as Error),
      ),
    ),
  );

const decodeJwt = (token: string): Effect.Effect<JwtPayload | null> =>
  Effect.gen(function* () {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1] ?? "";
    return yield* decodeJson(atob(payload)).pipe(
      Effect.map((value): JwtPayload | null => value as JwtPayload),
      Effect.orElseSucceed(() => null),
    );
  }).pipe(Effect.catchDefect(() => Effect.succeed(null)));

const accountIdOf = (accessToken: string): Effect.Effect<string | null> =>
  Effect.map(decodeJwt(accessToken), (payload) => {
    const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
  });

export const credentialsFromToken = (token: OAuthToken): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const accountId = yield* accountIdOf(token.access);
    if (accountId === null || accountId === "") {
      return yield* Effect.die(new Error("Failed to extract accountId from token"));
    }
    return {
      type: "oauth",
      access: token.access,
      refresh: token.refresh,
      expires: token.expires,
      accountId,
    };
  });

interface TokenRead {
  readonly reply: HttpReply;
  readonly operation: TokenOperation;
}

const readTokenResponse = ({ reply, operation }: TokenRead): Effect.Effect<OAuthToken> =>
  Effect.gen(function* () {
    if (!reply.ok) {
      const text = yield* readText(reply);
      return yield* Effect.die(
        new Error(`OpenAI Codex token ${operation} failed (${reply.status}): ${text}`),
      );
    }

    const json = (yield* reply.json) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    } | null;
    if (
      json?.access_token === undefined ||
      json.access_token === "" ||
      json.refresh_token === undefined ||
      json.refresh_token === "" ||
      typeof json.expires_in !== "number"
    ) {
      return yield* Effect.die(
        new Error(
          `OpenAI Codex token ${operation} response missing fields: ${yield* encodeJson(json)}`,
        ),
      );
    }

    const now = yield* Clock.currentTimeMillis;
    return {
      access: json.access_token,
      refresh: json.refresh_token,
      expires: now + json.expires_in * 1000,
    };
  });

export interface CodeExchange {
  readonly code: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly signal: AbortSignal;
}

export const exchangeAuthorizationCode = ({
  code,
  verifier,
  redirectUri,
  signal,
}: CodeExchange): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const reply = yield* requestWithLoginCancellation({
      url: TOKEN_URL,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }).toString(),
      signal,
    });
    return yield* credentialsFromToken(yield* readTokenResponse({ reply, operation: "exchange" }));
  });

export interface TokenRefresh {
  readonly refreshToken: string;
  readonly signal: AbortSignal;
}

export const refreshCodexToken = ({
  refreshToken,
  signal,
}: TokenRefresh): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      url: TOKEN_URL,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }).toString(),
      signal,
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.die(
          new Error(
            `OpenAI Codex token refresh error: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          ),
        ),
      ),
    );
    return yield* credentialsFromToken(yield* readTokenResponse({ reply, operation: "refresh" }));
  });
