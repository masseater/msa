import type compatTypes from "@msa/ai/compat.types";
import http from "@msa/ai/utils/http";
import { Clock, Data, Effect, Option, Schema } from "effect";
import { dual } from "effect/Function";

const { httpRequest } = http;

const decode = (s: string) => atob(s);
const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const REDIRECT_URI = "https://console.anthropic.com/oauth/code/callback";
const SCOPES = "org:create_api_key user:profile user:inference";

export const isOAuthToken = (apiKey: string): boolean => apiKey.includes("sk-ant-oat");

class AnthropicAuthError extends Data.TaggedError("AnthropicAuthError")<{
  readonly message: string;
}> {}

const TokenSchema = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Finite,
  refresh_token: Schema.String,
});

const decodeToken = Schema.decodeUnknownOption(Schema.fromJsonString(TokenSchema));

const TokenRequestSchema = Schema.Struct({
  client_id: Schema.String,
  code: Schema.optional(Schema.String),
  code_verifier: Schema.optional(Schema.String),
  grant_type: Schema.String,
  redirect_uri: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
});

const encodeTokenRequest = Schema.encodeEffect(Schema.fromJsonString(TokenRequestSchema));

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");

const generatePKCE = (): Promise<{ verifier: string; challenge: string }> => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = base64Url(array);
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(verifier))
    .then((hash) => ({ challenge: base64Url(new Uint8Array(hash)), verifier }));
};

const requestToken = (body: typeof TokenRequestSchema.Type, signal?: AbortSignal) =>
  Effect.gen(function* () {
    const payload = yield* encodeTokenRequest(body).pipe(Effect.orDie);
    const reply = yield* httpRequest({
      body: payload,
      headers: { "Content-Type": "application/json" },
      method: "POST",
      url: TOKEN_URL,
      ...(signal === undefined ? {} : { signal }),
    });

    if (!reply.ok) {
      return yield* new AnthropicAuthError({
        message: `Token request failed: ${yield* reply.text}`,
      });
    }

    const parsed = decodeToken(yield* reply.json);
    if (Option.isNone(parsed)) {
      return yield* new AnthropicAuthError({ message: "Unexpected token response" });
    }
    return parsed.value;
  });

const credentialsOf = (
  token: typeof TokenSchema.Type,
  now: number,
): compatTypes.OAuthCredentials => ({
  access: token.access_token,
  expires: now + token.expires_in * 1000 - 5 * 60 * 1000,
  refresh: token.refresh_token,
});

export const loginAnthropic = (
  callbacks: compatTypes.OAuthLoginCallbacks,
): Promise<compatTypes.OAuthCredentials> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { verifier, challenge } = yield* Effect.promise(generatePKCE);
      const authParams = new URLSearchParams({
        client_id: CLIENT_ID,
        code: "true",
        code_challenge: challenge,
        code_challenge_method: "S256",
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: SCOPES,
        state: verifier,
      });

      callbacks.onAuth({ url: `${AUTHORIZE_URL}?${authParams.toString()}` });
      const authCode = yield* Effect.promise(() =>
        callbacks.onPrompt({ message: "Paste the authorization code:" }),
      );
      const [code = "", state = ""] = authCode.split("#");

      const token = yield* requestToken({
        client_id: CLIENT_ID,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
        state,
      });
      return credentialsOf(token, yield* Clock.currentTimeMillis);
    }),
  );

const refreshAnthropicTokenImpl = (
  credentials: compatTypes.OAuthCredentials,
  signal: AbortSignal,
): Promise<compatTypes.OAuthCredentials> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const token = yield* requestToken(
        {
          client_id: CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: credentials.refresh,
        },
        signal,
      );
      return credentialsOf(token, yield* Clock.currentTimeMillis);
    }),
  );

export const refreshAnthropicToken: {
  (
    credentials: compatTypes.OAuthCredentials,
    signal: AbortSignal,
  ): Promise<compatTypes.OAuthCredentials>;
  (
    signal: AbortSignal,
  ): (credentials: compatTypes.OAuthCredentials) => Promise<compatTypes.OAuthCredentials>;
} = dual((args: IArguments) => args.length >= 2, refreshAnthropicTokenImpl);
