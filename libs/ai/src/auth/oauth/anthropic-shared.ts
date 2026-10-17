import { Clock, Effect } from "effect";

import { httpRequest } from "../../utils/http.ts";
import { decodeJson, encodeJson } from "../../utils/json-codec.ts";
import { getProviderEnvValue } from "../../utils/provider-env.ts";
import type { OAuthCredential } from "../types.ts";
import { readText } from "./response-json.ts";

const decode = (value: string): string => atob(value);

export const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
export const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
export const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
export const CALLBACK_HOST = getProviderEnvValue("MSA_OAUTH_CALLBACK_HOST") ?? "127.0.0.1";
export const CALLBACK_PORT = 53692;
export const CALLBACK_PATH = "/callback";
export const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
export const COPY_CODE_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
export const BROWSER_LOGIN_METHOD = "browser";
export const COPY_CODE_LOGIN_METHOD = "copy_code";
export const SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

const REQUEST_TIMEOUT_MS = 30_000;
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export const formatErrorDetails = (error: unknown): string => {
  if (error instanceof Error) {
    const details: string[] = [`${error.name}: ${error.message}`];
    const errorWithCode = error as Error & {
      code?: string;
      errno?: number | string;
    };
    if (errorWithCode.code !== undefined && errorWithCode.code !== "")
      details.push(`code=${errorWithCode.code}`);
    if (errorWithCode.errno !== undefined) details.push(`errno=${String(errorWithCode.errno)}`);
    if (error.cause !== undefined) {
      details.push(`cause=${formatErrorDetails(error.cause)}`);
    }
    if (error.stack !== undefined && error.stack !== "") {
      details.push(`stack=${error.stack}`);
    }
    return details.join("; ");
  }
  return String(error);
};

interface JsonPost {
  readonly url: string;
  readonly body: Record<string, string | number>;
  readonly signal: AbortSignal;
}

const postJson = ({ url, body, signal }: JsonPost): Effect.Effect<string> =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: yield* encodeJson(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
    const responseBody = yield* readText(reply);
    if (!reply.ok) {
      return yield* Effect.die(
        new Error(`HTTP request failed. status=${reply.status}; url=${url}; body=${responseBody}`),
      );
    }
    return responseBody;
  });

interface TokenFields {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
}

export interface TokenPost {
  readonly body: Record<string, string | number>;
  readonly signal: AbortSignal;
  readonly requestFailure: (error: unknown) => Error;
  readonly jsonFailure: (responseBody: string, error: unknown) => Error;
}

export const requestAnthropicToken = ({
  body,
  signal,
  requestFailure,
  jsonFailure,
}: TokenPost): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const responseBody = yield* postJson({ url: TOKEN_URL, body, signal }).pipe(
      Effect.catchDefect((error) => Effect.die(requestFailure(error))),
    );
    const tokenData = (yield* decodeJson(responseBody).pipe(
      Effect.catch((error) => Effect.die(jsonFailure(responseBody, error))),
    )) as TokenFields;
    const now = yield* Clock.currentTimeMillis;
    return {
      type: "oauth",
      refresh: tokenData.refresh_token,
      access: tokenData.access_token,
      expires: now + tokenData.expires_in * 1000 - EXPIRY_MARGIN_MS,
    };
  });

export interface CodeExchange {
  readonly code: string;
  readonly state: string;
  readonly verifier: string;
  readonly redirectUri: string;
  readonly signal: AbortSignal;
}

export const exchangeAuthorizationCode = ({
  code,
  state,
  verifier,
  redirectUri,
  signal,
}: CodeExchange): Effect.Effect<OAuthCredential> =>
  requestAnthropicToken({
    body: {
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code,
      state,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
    signal,
    requestFailure: (error) =>
      new Error(
        `Token exchange request failed. url=${TOKEN_URL}; redirect_uri=${redirectUri}; response_type=authorization_code; details=${formatErrorDetails(error)}`,
        { cause: error },
      ),
    jsonFailure: (responseBody, error) =>
      new Error(
        `Token exchange returned invalid JSON. url=${TOKEN_URL}; body=${responseBody}; details=${formatErrorDetails(error)}`,
        { cause: error },
      ),
  });

export interface TokenRefresh {
  readonly refreshToken: string;
  readonly signal: AbortSignal;
}

export const refreshAnthropicToken = ({
  refreshToken,
  signal,
}: TokenRefresh): Effect.Effect<OAuthCredential> =>
  requestAnthropicToken({
    body: { grant_type: "refresh_token", client_id: CLIENT_ID, refresh_token: refreshToken },
    signal,
    requestFailure: (error) =>
      new Error(
        `Anthropic token refresh request failed. url=${TOKEN_URL}; details=${formatErrorDetails(error)}`,
        { cause: error },
      ),
    jsonFailure: (responseBody, error) =>
      new Error(
        `Anthropic token refresh returned invalid JSON. url=${TOKEN_URL}; body=${responseBody}; details=${formatErrorDetails(error)}`,
        { cause: error },
      ),
  });

export interface AuthorizeUrl {
  readonly redirectUri: string;
  readonly challenge: string;
  readonly verifier: string;
}

export const authorizeUrl = ({ redirectUri, challenge, verifier }: AuthorizeUrl): string => {
  const authParams = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: verifier,
  });
  return `${AUTHORIZE_URL}?${authParams.toString()}`;
};
