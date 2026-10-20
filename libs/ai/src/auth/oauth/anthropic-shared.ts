import { Clock, Effect } from "effect";

import http from "../../utils/http.ts";
import jsonCodec from "../../utils/json-codec.ts";
import providerEnv from "../../utils/provider-env.ts";
import type typesModule from "../types.ts";
import type anthropicSharedTypes from "./anthropic-shared.types.ts";
import responseJson from "./response-json.ts";

const { getProviderEnvValue } = providerEnv;
const { httpRequest } = http;
const { decodeJson, encodeJson } = jsonCodec;
const { readText } = responseJson;

const decode = (value: string): string => atob(value);

const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CALLBACK_HOST = getProviderEnvValue("MSA_OAUTH_CALLBACK_HOST") ?? "127.0.0.1";
const CALLBACK_PORT = 53692;
const CALLBACK_PATH = "/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const COPY_CODE_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback";
const BROWSER_LOGIN_METHOD = "browser";
const COPY_CODE_LOGIN_METHOD = "copy_code";
const SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

const REQUEST_TIMEOUT_MS = 30_000;
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

const formatErrorDetails = (error: unknown): string => {
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
      body: yield* encodeJson(body),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST",
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      url,
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

const requestAnthropicToken = ({
  body,
  signal,
  requestFailure,
  jsonFailure,
}: anthropicSharedTypes.TokenPost): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    const responseBody = yield* postJson({ body, signal, url: TOKEN_URL }).pipe(
      Effect.catchDefect((error) => Effect.die(requestFailure(error))),
    );
    const tokenData = (yield* decodeJson(responseBody).pipe(
      Effect.catch((error) => Effect.die(jsonFailure(responseBody, error))),
    )) as TokenFields;
    const now = yield* Clock.currentTimeMillis;
    return {
      access: tokenData.access_token,
      expires: now + tokenData.expires_in * 1000 - EXPIRY_MARGIN_MS,
      refresh: tokenData.refresh_token,
      type: "oauth",
    };
  });

const exchangeAuthorizationCode = ({
  code,
  state,
  verifier,
  redirectUri,
  signal,
}: anthropicSharedTypes.CodeExchange): Effect.Effect<typesModule.OAuthCredential> =>
  requestAnthropicToken({
    body: {
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      state,
    },
    jsonFailure: (responseBody, error) =>
      new Error(
        `Token exchange returned invalid JSON. url=${TOKEN_URL}; body=${responseBody}; details=${formatErrorDetails(error)}`,
        { cause: error },
      ),
    requestFailure: (error) =>
      new Error(
        `Token exchange request failed. url=${TOKEN_URL}; redirect_uri=${redirectUri}; response_type=authorization_code; details=${formatErrorDetails(error)}`,
        { cause: error },
      ),
    signal,
  });

const refreshAnthropicToken = ({
  refreshToken,
  signal,
}: anthropicSharedTypes.TokenRefresh): Effect.Effect<typesModule.OAuthCredential> =>
  requestAnthropicToken({
    body: { client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: refreshToken },
    jsonFailure: (responseBody, error) =>
      new Error(
        `Anthropic token refresh returned invalid JSON. url=${TOKEN_URL}; body=${responseBody}; details=${formatErrorDetails(error)}`,
        { cause: error },
      ),
    requestFailure: (error) =>
      new Error(
        `Anthropic token refresh request failed. url=${TOKEN_URL}; details=${formatErrorDetails(error)}`,
        { cause: error },
      ),
    signal,
  });

const authorizeUrl = ({
  redirectUri,
  challenge,
  verifier,
}: anthropicSharedTypes.AuthorizeUrl): string => {
  const authParams = new URLSearchParams({
    client_id: CLIENT_ID,
    code: "true",
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    state: verifier,
  });
  return `${AUTHORIZE_URL}?${authParams.toString()}`;
};

const anthropicShared = {
  AUTHORIZE_URL,
  BROWSER_LOGIN_METHOD,
  CALLBACK_HOST,
  CALLBACK_PATH,
  CALLBACK_PORT,
  CLIENT_ID,
  COPY_CODE_LOGIN_METHOD,
  COPY_CODE_REDIRECT_URI,
  REDIRECT_URI,
  SCOPES,
  TOKEN_URL,
  authorizeUrl,
  exchangeAuthorizationCode,
  formatErrorDetails,
  refreshAnthropicToken,
  requestAnthropicToken,
};

export default anthropicShared;
