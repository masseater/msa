import { Clock, Effect } from "effect";

import { encodeJson } from "../../utils/json-codec.ts";
import { getProviderEnvValue } from "../../utils/provider-env.ts";
import type { OAuthCredential } from "../types.ts";

export const CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
export const DEVICE_CODE_TIMEOUT_SECONDS = 15 * 60;
export const DEFAULT_POLL_INTERVAL_SECONDS = 5;

const DEFAULT_OAUTH_HOST = "https://auth.kimi.com";

export interface TokenResponse {
  readonly access: string;
  readonly refresh: string;
  readonly expires: number;
}

export const getOauthHost = (): string => {
  const override =
    getProviderEnvValue("KIMI_CODE_OAUTH_HOST") ?? getProviderEnvValue("KIMI_OAUTH_HOST");
  return (override ?? DEFAULT_OAUTH_HOST).replace(/\/+$/u, "");
};

export const tokenUrl = (oauthHost: string): string => `${oauthHost}/api/oauth/token`;

export interface TokenParse {
  readonly json: Record<string, unknown> | null;
  readonly operation: string;
}

export const parseTokenResponse = ({ json, operation }: TokenParse): Effect.Effect<TokenResponse> =>
  Effect.gen(function* () {
    const accessToken = json?.["access_token"];
    const refreshValue = json?.["refresh_token"];
    const expiresIn = json?.["expires_in"];
    if (
      typeof accessToken !== "string" ||
      accessToken === "" ||
      typeof refreshValue !== "string" ||
      refreshValue === "" ||
      typeof expiresIn !== "number" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      return yield* Effect.die(
        new Error(
          `Kimi Code token ${operation} response missing fields: ${yield* encodeJson(json)}`,
        ),
      );
    }
    const now = yield* Clock.currentTimeMillis;
    return { access: accessToken, refresh: refreshValue, expires: now + expiresIn * 1000 };
  });

export const toCredential = (token: TokenResponse): OAuthCredential => ({
  type: "oauth",
  access: token.access,
  refresh: token.refresh,
  expires: token.expires,
});
