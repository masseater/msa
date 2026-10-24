import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import type compatTypes from "@msa/ai/compat.types";
import http from "@msa/ai/utils/http";
import { Clock, Crypto, Effect, ManagedRuntime, Option, Schema } from "effect";
import { dual } from "effect/Function";

import config from "./config.ts";
import type configTypes from "./config.types.ts";
import GitLabAuthError from "./git-lab-auth-error.ts";

const { BUNDLED_CLIENT_ID, DIRECT_ACCESS_TTL, GITLAB_COM_URL, OAUTH_SCOPES, REDIRECT_URI } = config;
const { httpRequest } = http;

const cryptoRuntime = ManagedRuntime.make(NodeCrypto.layer);
const randomUuid = (): string =>
  cryptoRuntime.runSync(Crypto.Crypto.use((crypto) => crypto.randomUUIDv4));
const DirectAccessSchema = Schema.Struct({
  headers: Schema.Record(Schema.String, Schema.String),
  token: Schema.String,
});
const TokenSchema = Schema.Struct({
  access_token: Schema.String,
  created_at: Schema.Finite,
  expires_in: Schema.Finite,
  refresh_token: Schema.String,
});
let cachedDirectAccess: configTypes.DirectAccessToken | null = null;
const invalidateDirectAccessToken = (): void => {
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
const getDirectAccessToken = (gitlabAccessToken: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    if (cachedDirectAccess !== null && cachedDirectAccess.expiresAt > now) {
      return cachedDirectAccess;
    }

    const reply = yield* httpRequest({
      body: yield* encodeDirectAccessRequest({
        feature_flags: { DuoAgentPlatformNext: true },
      }).pipe(Effect.orDie),
      headers: {
        Authorization: `Bearer ${gitlabAccessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      url: `${GITLAB_COM_URL}/api/v4/ai/third_party_agents/direct_access`,
    });

    if (!reply.ok) {
      const errorText = yield* reply.text;
      if (reply.status === 403) {
        return yield* GitLabAuthError.make({
          message: `GitLab Duo access denied. Ensure GitLab Duo is enabled for your account. Error: ${errorText}`,
        });
      }
      return yield* GitLabAuthError.make({
        message: `Failed to get direct access token: ${reply.status} ${errorText}`,
      });
    }

    const parsed = decodeDirectAccess(yield* reply.json);
    if (Option.isNone(parsed)) {
      return yield* GitLabAuthError.make({ message: "Unexpected direct access response" });
    }

    cachedDirectAccess = {
      expiresAt: now + DIRECT_ACCESS_TTL,
      headers: parsed.value.headers,
      token: parsed.value.token,
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
    challenge: base64Url(new Uint8Array(hash)),
    verifier,
  }));
};
const exchangeCode = (params: { code: string; verifier: string }) =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      body: new URLSearchParams({
        client_id: BUNDLED_CLIENT_ID,
        code: params.code,
        code_verifier: params.verifier,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      url: `${GITLAB_COM_URL}/oauth/token`,
    });

    if (!reply.ok) {
      return yield* GitLabAuthError.make({
        message: `Token exchange failed: ${yield* reply.text}`,
      });
    }

    const parsed = decodeToken(yield* reply.json);
    if (Option.isNone(parsed)) {
      return yield* GitLabAuthError.make({ message: "Unexpected token response" });
    }
    return parsed.value;
  });
const loginGitLab = (
  callbacks: compatTypes.OAuthLoginCallbacks,
): Promise<compatTypes.OAuthCredentials> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { verifier, challenge } = yield* Effect.promise(generatePKCE);
      const authParams = new URLSearchParams({
        client_id: BUNDLED_CLIENT_ID,
        code_challenge: challenge,
        code_challenge_method: "S256",
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: OAUTH_SCOPES.join(" "),
        state: randomUuid(),
      });

      callbacks.onAuth({ url: `${GITLAB_COM_URL}/oauth/authorize?${authParams.toString()}` });
      const callbackUrl = yield* Effect.promise(() =>
        callbacks.onPrompt({ message: "Paste the callback URL:" }),
      );

      const code = new URL(callbackUrl).searchParams.get("code");
      if (code === null || code.length === 0) {
        return yield* GitLabAuthError.make({
          message: "No authorization code found in callback URL",
        });
      }

      const token = yield* exchangeCode({ code, verifier });
      invalidateDirectAccessToken();
      return {
        access: token.access_token,
        expires: expiryOf(token),
        refresh: token.refresh_token,
      };
    }),
  );
const refreshGitLabTokenImpl = (
  credentials: compatTypes.OAuthCredentials,
  signal: AbortSignal,
): Promise<compatTypes.OAuthCredentials> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const reply = yield* httpRequest({
        body: new URLSearchParams({
          client_id: BUNDLED_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: credentials.refresh,
        }).toString(),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
        signal,
        url: `${GITLAB_COM_URL}/oauth/token`,
      });

      if (!reply.ok) {
        return yield* GitLabAuthError.make({
          message: `Token refresh failed: ${yield* reply.text}`,
        });
      }

      const parsed = decodeToken(yield* reply.json);
      if (Option.isNone(parsed)) {
        return yield* GitLabAuthError.make({ message: "Unexpected token response" });
      }

      invalidateDirectAccessToken();
      return {
        access: parsed.value.access_token,
        expires: expiryOf(parsed.value),
        refresh: parsed.value.refresh_token,
      };
    }),
  );
const refreshGitLabToken: {
  (
    credentials: compatTypes.OAuthCredentials,
    signal: AbortSignal,
  ): Promise<compatTypes.OAuthCredentials>;
  (
    signal: AbortSignal,
  ): (credentials: compatTypes.OAuthCredentials) => Promise<compatTypes.OAuthCredentials>;
} = dual((args: IArguments) => args.length >= 2, refreshGitLabTokenImpl);

const auth = {
  getDirectAccessToken,
  invalidateDirectAccessToken,
  loginGitLab,
  refreshGitLabToken,
};

export default auth;
