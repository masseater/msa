import type { OAuthCredentials, OAuthLoginCallbacks } from "@msa/ai/compat";
import { httpRequest } from "@msa/ai/utils/http";
import { Clock, Data, Effect, Option, Schema } from "effect";
import { dual } from "effect/Function";

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
  refresh_token: Schema.String,
  expires_in: Schema.Finite,
});

const decodeToken = Schema.decodeUnknownOption(Schema.fromJsonString(TokenSchema));

const TokenRequestSchema = Schema.Struct({
  grant_type: Schema.String,
  client_id: Schema.String,
  code: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
  redirect_uri: Schema.optional(Schema.String),
  code_verifier: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
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
    .then((hash) => ({ verifier, challenge: base64Url(new Uint8Array(hash)) }));
};

const requestToken = (body: typeof TokenRequestSchema.Type, signal?: AbortSignal) =>
  Effect.gen(function* () {
    const payload = yield* encodeTokenRequest(body).pipe(Effect.orDie);
    const reply = yield* httpRequest({
      url: TOKEN_URL,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
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

const credentialsOf = (token: typeof TokenSchema.Type, now: number): OAuthCredentials => ({
  refresh: token.refresh_token,
  access: token.access_token,
  expires: now + token.expires_in * 1000 - 5 * 60 * 1000,
});

export const loginAnthropic = (callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { verifier, challenge } = yield* Effect.promise(generatePKCE);
      const authParams = new URLSearchParams({
        code: "true",
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: verifier,
      });

      callbacks.onAuth({ url: `${AUTHORIZE_URL}?${authParams.toString()}` });
      const authCode = yield* Effect.promise(() =>
        callbacks.onPrompt({ message: "Paste the authorization code:" }),
      );
      const [code = "", state = ""] = authCode.split("#");

      const token = yield* requestToken({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        state,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      });
      return credentialsOf(token, yield* Clock.currentTimeMillis);
    }),
  );

const refreshAnthropicTokenImpl = (
  credentials: OAuthCredentials,
  signal: AbortSignal,
): Promise<OAuthCredentials> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const token = yield* requestToken(
        {
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: credentials.refresh,
        },
        signal,
      );
      return credentialsOf(token, yield* Clock.currentTimeMillis);
    }),
  );

export const refreshAnthropicToken: {
  (credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials>;
  (signal: AbortSignal): (credentials: OAuthCredentials) => Promise<OAuthCredentials>;
} = dual((args: IArguments) => args.length >= 2, refreshAnthropicTokenImpl);
