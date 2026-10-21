import { Clock, Effect } from "effect";

import http from "../../utils/http.ts";
import type httpTypes from "../../utils/http.types.ts";
import jsonCodec from "../../utils/json-codec.ts";
import providerEnv from "../../utils/provider-env.ts";
import type typesModule from "../types.ts";
import type openaiCodexSharedTypes from "./openai-codex-shared.types.ts";
import responseJson from "./response-json.ts";

const { getProviderEnvValue } = providerEnv;
const { httpRequest } = http;
const { decodeJson, encodeJson } = jsonCodec;
const { readText } = responseJson;

const AUTH_BASE_URL = "https://auth.openai.com";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = `${AUTH_BASE_URL}/oauth/authorize`;
const TOKEN_URL = `${AUTH_BASE_URL}/oauth/token`;
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const DEVICE_USER_CODE_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/usercode`;
const DEVICE_TOKEN_URL = `${AUTH_BASE_URL}/api/accounts/deviceauth/token`;
const DEVICE_VERIFICATION_URI = `${AUTH_BASE_URL}/codex/device`;
const DEVICE_REDIRECT_URI = `${AUTH_BASE_URL}/deviceauth/callback`;
const DEVICE_CODE_TIMEOUT_SECONDS = 15 * 60;
const BROWSER_LOGIN_METHOD = "browser";
const DEVICE_CODE_LOGIN_METHOD = "device_code";
const SCOPE = "openid profile email offline_access";

const JWT_CLAIM_PATH = "https://api.openai.com/auth";

type TokenOperation = "exchange" | "refresh";

interface JwtPayload {
  readonly [JWT_CLAIM_PATH]?: {
    readonly chatgpt_account_id?: string;
  };
  readonly [key: string]: unknown;
}

const getCallbackHost = (): string => getProviderEnvValue("MSA_OAUTH_CALLBACK_HOST") ?? "127.0.0.1";

const requestWithLoginCancellation = (
  request: httpTypes.HttpRequest,
): Effect.Effect<httpTypes.HttpReply> =>
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

const credentialsFromToken = (
  token: openaiCodexSharedTypes.OAuthToken,
): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    const accountId = yield* accountIdOf(token.access);
    if (accountId === null || accountId === "") {
      return yield* Effect.die(new Error("Failed to extract accountId from token"));
    }
    return {
      access: token.access,
      accountId,
      expires: token.expires,
      refresh: token.refresh,
      type: "oauth",
    };
  });

interface TokenRead {
  readonly reply: httpTypes.HttpReply;
  readonly operation: TokenOperation;
}

const readTokenResponse = ({
  reply,
  operation,
}: TokenRead): Effect.Effect<openaiCodexSharedTypes.OAuthToken> =>
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
      expires: now + json.expires_in * 1000,
      refresh: json.refresh_token,
    };
  });

const exchangeAuthorizationCode = ({
  code,
  verifier,
  redirectUri,
  signal,
}: openaiCodexSharedTypes.CodeExchange): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    const reply = yield* requestWithLoginCancellation({
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal,
      url: TOKEN_URL,
    });
    return yield* credentialsFromToken(yield* readTokenResponse({ operation: "exchange", reply }));
  });

const refreshCodexToken = ({
  refreshToken,
  signal,
}: openaiCodexSharedTypes.TokenRefresh): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      signal,
      url: TOKEN_URL,
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
    return yield* credentialsFromToken(yield* readTokenResponse({ operation: "refresh", reply }));
  });

const openaiCodexShared = {
  AUTHORIZE_URL,
  BROWSER_LOGIN_METHOD,
  CLIENT_ID,
  DEVICE_CODE_LOGIN_METHOD,
  DEVICE_CODE_TIMEOUT_SECONDS,
  DEVICE_REDIRECT_URI,
  DEVICE_TOKEN_URL,
  DEVICE_USER_CODE_URL,
  DEVICE_VERIFICATION_URI,
  REDIRECT_URI,
  SCOPE,
  TOKEN_URL,
  credentialsFromToken,
  exchangeAuthorizationCode,
  getCallbackHost,
  refreshCodexToken,
  requestWithLoginCancellation,
};

export default openaiCodexShared;
