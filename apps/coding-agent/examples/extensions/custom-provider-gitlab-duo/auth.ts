import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@msa/ai/compat";
import { httpRequest } from "@msa/ai/utils/http";
import { Clock, Crypto, Data, Effect, ManagedRuntime, Option, Schema } from "effect";
import { dual } from "effect/Function";

import {
  BUNDLED_CLIENT_ID,
  type DirectAccessToken,
  DIRECT_ACCESS_TTL,
  GITLAB_COM_URL,
  OAUTH_SCOPES,
  REDIRECT_URI,
} from "./config.ts";

const cryptoRuntime = ManagedRuntime.make(NodeCrypto.layer);

const randomUuid = (): string =>
  cryptoRuntime.runSync(Crypto.Crypto.use((crypto) => crypto.randomUUIDv4));

export class GitLabAuthError extends Data.TaggedError("GitLabAuthError")<{
  readonly message: string;
}> {}

const DirectAccessSchema = Schema.Struct({
  token: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
});

const TokenSchema = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Finite,
  created_at: Schema.Finite,
});

let cachedDirectAccess: DirectAccessToken | null = null;

export const invalidateDirectAccessToken = (): void => {
  cachedDirectAccess = null;
};

const DirectAccessRequestSchema = Schema.Struct({
  feature_flags: Schema.Struct({ DuoAgentPlatformNext: Schema.Boolean }),
});

const encodeDirectAccessRequest = Schema.encodeEffect(
  Schema.fromJsonString(DirectAccessRequestSchema),
);

const decodeDirectAccess = Schema.decodeUnknownOption(Schema.fromJsonString(DirectAccessSchema));
const decodeToken = Schema.decodeUnknownOption(Schema.fromJsonString(TokenSchema));

const expiryOf = (token: typeof TokenSchema.Type): number =>
  (token.created_at + token.expires_in) * 1000 - 5 * 60 * 1000;

export const getDirectAccessToken = (gitlabAccessToken: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (cachedDirectAccess !== null && cachedDirectAccess.expiresAt > now) {
      return cachedDirectAccess;
    }

    const reply = yield* httpRequest({
      url: `${GITLAB_COM_URL}/api/v4/ai/third_party_agents/direct_access`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${gitlabAccessToken}`,
        "Content-Type": "application/json",
      },
      body: yield* encodeDirectAccessRequest({
        feature_flags: { DuoAgentPlatformNext: true },
      }).pipe(Effect.orDie),
    });

    if (!reply.ok) {
      const errorText = yield* reply.text;
      if (reply.status === 403) {
        return yield* new GitLabAuthError({
          message: `GitLab Duo access denied. Ensure GitLab Duo is enabled for your account. Error: ${errorText}`,
        });
      }
      return yield* new GitLabAuthError({
        message: `Failed to get direct access token: ${reply.status} ${errorText}`,
      });
    }

    const parsed = decodeDirectAccess(yield* reply.json);
    if (Option.isNone(parsed)) {
      return yield* new GitLabAuthError({ message: "Unexpected direct access response" });
    }

    cachedDirectAccess = {
      token: parsed.value.token,
      headers: parsed.value.headers,
      expiresAt: now + DIRECT_ACCESS_TTL,
    };
    return cachedDirectAccess;
  });

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");

const generatePKCE = (): Promise<{ verifier: string; challenge: string }> => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const verifier = base64Url(array);
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then((hash) => ({
    verifier,
    challenge: base64Url(new Uint8Array(hash)),
  }));
};

const exchangeCode = (params: { code: string; verifier: string }) =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      url: `${GITLAB_COM_URL}/oauth/token`,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: BUNDLED_CLIENT_ID,
        grant_type: "authorization_code",
        code: params.code,
        code_verifier: params.verifier,
        redirect_uri: REDIRECT_URI,
      }).toString(),
    });

    if (!reply.ok) {
      return yield* new GitLabAuthError({
        message: `Token exchange failed: ${yield* reply.text}`,
      });
    }

    const parsed = decodeToken(yield* reply.json);
    if (Option.isNone(parsed)) {
      return yield* new GitLabAuthError({ message: "Unexpected token response" });
    }
    return parsed.value;
  });

export const loginGitLab = (callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { verifier, challenge } = yield* Effect.promise(generatePKCE);
      const authParams = new URLSearchParams({
        client_id: BUNDLED_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: OAUTH_SCOPES.join(" "),
        code_challenge: challenge,
        code_challenge_method: "S256",
        state: randomUuid(),
      });

      callbacks.onAuth({ url: `${GITLAB_COM_URL}/oauth/authorize?${authParams.toString()}` });
      const callbackUrl = yield* Effect.promise(() =>
        callbacks.onPrompt({ message: "Paste the callback URL:" }),
      );

      const code = new URL(callbackUrl).searchParams.get("code");
      if (code === null || code.length === 0) {
        return yield* new GitLabAuthError({
          message: "No authorization code found in callback URL",
        });
      }

      const token = yield* exchangeCode({ code, verifier });
      invalidateDirectAccessToken();
      return {
        refresh: token.refresh_token,
        access: token.access_token,
        expires: expiryOf(token),
      };
    }),
  );

const refreshGitLabTokenImpl = (
  credentials: OAuthCredentials,
  signal: AbortSignal,
): Promise<OAuthCredentials> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const reply = yield* httpRequest({
        url: `${GITLAB_COM_URL}/oauth/token`,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: BUNDLED_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: credentials.refresh,
        }).toString(),
        signal,
      });

      if (!reply.ok) {
        return yield* new GitLabAuthError({
          message: `Token refresh failed: ${yield* reply.text}`,
        });
      }

      const parsed = decodeToken(yield* reply.json);
      if (Option.isNone(parsed)) {
        return yield* new GitLabAuthError({ message: "Unexpected token response" });
      }

      invalidateDirectAccessToken();
      return {
        refresh: parsed.value.refresh_token,
        access: parsed.value.access_token,
        expires: expiryOf(parsed.value),
      };
    }),
  );

export const refreshGitLabToken: {
  (credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials>;
  (signal: AbortSignal): (credentials: OAuthCredentials) => Promise<OAuthCredentials>;
} = dual((args: IArguments) => args.length >= 2, refreshGitLabTokenImpl);
