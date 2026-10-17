import { Clock, Effect } from "effect";

import { type HttpReply, httpRequest } from "../../utils/http.ts";
import { encodeJson } from "../../utils/json-codec.ts";
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "../types.ts";
import { pollOAuthDeviceCodeFlow } from "./device-code.ts";

const CLIENT_ID = "1031625952748946";
const AUTH_HOST = "https://auth.meta.com";
const DEVICE_AUTHORIZATION_URL = `${AUTH_HOST}/oidc/device/authorization/`;
const DEVICE_TOKEN_URL = `${AUTH_HOST}/oidc/device/token/`;
const API_KEY_MINT_URL = "https://api.meta.ai/muse-code/key";
const API_KEY_LIFETIME_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number | undefined;
  expiresInSeconds?: number | undefined;
};

const requestSignal = (signal: AbortSignal): AbortSignal =>
  AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]);

const readJson = (reply: HttpReply): Effect.Effect<Record<string, unknown> | null> =>
  reply.json.pipe(
    Effect.map((json) =>
      json !== null && typeof json === "object" ? (json as Record<string, unknown>) : null,
    ),
    Effect.catchDefect(() => Effect.succeed(null)),
  );

const errorDetail = (json: Record<string, unknown> | null): string => {
  for (const key of ["error_description", "detail", "message", "error"]) {
    const value = json?.[key];
    if (typeof value === "string" && value.trim() !== "") return `: ${value.trim()}`;
  }
  return "";
};

const trustedHttpUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || value === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
};

const positiveNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const formHeaders = {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
} as const;

const startDeviceAuthorization = (signal: AbortSignal): Effect.Effect<DeviceAuthorization> =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      url: DEVICE_AUTHORIZATION_URL,
      method: "POST",
      headers: formHeaders,
      body: new URLSearchParams({ client_id: CLIENT_ID }).toString(),
      signal: requestSignal(signal),
    });
    const json = yield* readJson(reply);
    if (!reply.ok) {
      return yield* Effect.die(
        new Error(
          `Meta device authorization failed with status ${reply.status}${errorDetail(json)}`,
        ),
      );
    }
    const deviceCode = json?.["device_code"];
    const userCode = json?.["user_code"];
    const verificationUri =
      trustedHttpUrl(json?.["verification_uri_complete"]) ??
      trustedHttpUrl(json?.["verification_uri"]);
    if (
      typeof deviceCode !== "string" ||
      deviceCode === "" ||
      typeof userCode !== "string" ||
      userCode === "" ||
      verificationUri === null ||
      verificationUri === ""
    ) {
      return yield* Effect.die(
        new Error(`Invalid Meta device authorization response: ${yield* encodeJson(json)}`),
      );
    }
    return {
      deviceCode,
      userCode,
      verificationUri,
      intervalSeconds: positiveNumber(json?.["interval"]),
      expiresInSeconds: positiveNumber(json?.["expires_in"]),
    };
  });

const pollIdentityTokenOnce = (device: DeviceAuthorization, signal: AbortSignal) =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      url: DEVICE_TOKEN_URL,
      method: "POST",
      headers: formHeaders,
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: device.deviceCode,
        client_id: CLIENT_ID,
      }).toString(),
      signal: requestSignal(signal),
    });
    const json = yield* readJson(reply);
    const accessToken = json?.["access_token"];
    if (reply.ok && typeof accessToken === "string" && accessToken !== "") {
      return { status: "complete" as const, value: accessToken };
    }
    switch (json?.["error"]) {
      case "authorization_pending":
        return { status: "pending" as const };
      case "slow_down":
        return {
          status: "slow_down" as const,
          intervalSeconds: positiveNumber(json?.["interval"]),
        };
      case "access_denied":
        return { status: "failed" as const, message: "Meta login was denied." };
      case "expired_token":
        return {
          status: "failed" as const,
          message: "Meta device authorization expired. Please restart login.",
        };
      default:
        return {
          status: "failed" as const,
          message: `Meta device token request failed with status ${reply.status}${errorDetail(json)}`,
        };
    }
  });

const pollForIdentityToken = (device: DeviceAuthorization, signal: AbortSignal): Promise<string> =>
  pollOAuthDeviceCodeFlow<string>({
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: device.expiresInSeconds,
    waitBeforeFirstPoll: true,
    signal,
    poll: () => Effect.runPromise(pollIdentityTokenOnce(device, signal)),
  });

const mintApiKeyEffect = (
  identityToken: string,
  signal: AbortSignal,
): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      url: API_KEY_MINT_URL,
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${identityToken}`,
        "Content-Type": "application/json",
        "x-api-version": "1.0.0",
      },
      body: "{}",
      signal: requestSignal(signal),
    });
    const json = yield* readJson(reply);
    if (reply.status === 401 || reply.status === 403) {
      return yield* Effect.die(
        new Error(
          `Meta session expired (status ${reply.status}). Run \`/login meta\` to sign in again.${errorDetail(json)}`,
        ),
      );
    }
    if (!reply.ok) {
      return yield* Effect.die(
        new Error(`Meta API key mint failed with status ${reply.status}${errorDetail(json)}`),
      );
    }
    const apiKey = json?.["api_key"];
    if (typeof apiKey !== "string" || apiKey === "") {
      const actionUrl = trustedHttpUrl(json?.["action_url"]);
      return yield* Effect.die(
        new Error(
          `Meta did not issue an API key.${actionUrl !== null && actionUrl !== "" ? ` Complete setup at ${actionUrl}` : ""}`,
        ),
      );
    }
    const now = yield* Clock.currentTimeMillis;
    return {
      type: "oauth" as const,
      refresh: identityToken,
      access: apiKey,
      expires: now + API_KEY_LIFETIME_MS,
    };
  });

const loginMeta = (interaction: ProviderAuthInteraction): Promise<OAuthCredential> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const device = yield* startDeviceAuthorization(interaction.signal);
      interaction.notify({
        type: "device_code",
        userCode: device.userCode,
        verificationUri: device.verificationUri,
        intervalSeconds: device.intervalSeconds,
        expiresInSeconds: device.expiresInSeconds,
      });
      const identityToken = yield* Effect.promise(() =>
        pollForIdentityToken(device, interaction.signal),
      );
      interaction.notify({ type: "progress", message: "Enabling Meta Model API access..." });
      return yield* mintApiKeyEffect(identityToken, interaction.signal);
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.die(
          interaction.signal.aborted
            ? new Error("Login cancelled", { cause: error })
            : (error as Error),
        ),
      ),
    ),
  );

export const metaOAuth: OAuthAuth = {
  name: "Meta (Muse subscription)",
  isSubscription: true,
  loginLabel: "Sign in with Meta",

  login: loginMeta,

  refresh: (credential, signal) => Effect.runPromise(mintApiKeyEffect(credential.refresh, signal)),

  toAuth(credential) {
    return Promise.resolve({ apiKey: credential.access });
  },
};
