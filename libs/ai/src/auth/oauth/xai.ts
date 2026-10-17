import { Clock, Effect } from "effect";

import { httpRequest } from "../../utils/http.ts";
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "../types.ts";
import { pollOAuthDeviceCodeFlow } from "./device-code.ts";

const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access";
const XAI_DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;

type JsonObject = Record<string, unknown>;

type OAuthHttpResponse = {
  ok: boolean;
  status: number;
  body: JsonObject;
};

type XaiDeviceCode = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string | undefined;
  intervalSeconds?: number | undefined;
  expiresInSeconds: number;
};

const requiredString = (body: JsonObject, field: string): string => {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid xAI OAuth response field: ${field}`);
  }
  return value;
};

const positiveNumber = (body: JsonObject, field: string): number => {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid xAI OAuth response field: ${field}`);
  }
  return value;
};

const validateVerificationUri = (raw: string): string => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Untrusted verification URI in xAI OAuth response");
  }
  if (url.protocol !== "https:") {
    throw new Error("Untrusted verification URI in xAI OAuth response");
  }
  return url.href;
};

const asJsonObject = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};

const postForm = (
  url: string,
  fields: Record<string, string>,
  signal: AbortSignal,
): Effect.Effect<OAuthHttpResponse> =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      url,
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields).toString(),
      signal,
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.die(
          signal.aborted ? new Error("Login cancelled", { cause: error }) : (error as Error),
        ),
      ),
    );

    const body = yield* reply.json.pipe(
      Effect.map(asJsonObject),
      Effect.catchDefect(() =>
        Effect.die(
          signal.aborted
            ? new Error("Login cancelled")
            : new Error(`xAI OAuth returned invalid JSON (HTTP ${reply.status})`),
        ),
      ),
    );
    return { ok: reply.ok, status: reply.status, body };
  });

const requestFailure = (action: string, response: OAuthHttpResponse): Error => {
  const error = typeof response.body["error"] === "string" ? response.body["error"] : undefined;
  const description =
    typeof response.body["error_description"] === "string"
      ? response.body["error_description"]
      : undefined;
  const detail = [error, description].filter((part) => part !== undefined).join(": ");
  return new Error(
    `xAI OAuth ${action} failed (HTTP ${response.status})${detail === "" ? "" : `: ${detail}`}`,
  );
};

const parseDeviceCode = (body: JsonObject): XaiDeviceCode => {
  const interval = body["interval"];
  const intervalSeconds =
    typeof interval === "number" && Number.isFinite(interval) && interval > 0
      ? interval
      : undefined;
  const complete = body["verification_uri_complete"];
  const verificationUriComplete =
    typeof complete === "string" && complete.length > 0
      ? validateVerificationUri(complete)
      : undefined;
  return {
    deviceCode: requiredString(body, "device_code"),
    userCode: requiredString(body, "user_code"),
    verificationUri: validateVerificationUri(requiredString(body, "verification_uri")),
    verificationUriComplete,
    intervalSeconds,
    expiresInSeconds: positiveNumber(body, "expires_in"),
  };
};

const credentialsFromTokenResponse = (
  body: JsonObject,
  previousRefreshToken?: string,
): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const access = requiredString(body, "access_token");
    const refresh =
      body["refresh_token"] === undefined &&
      previousRefreshToken !== undefined &&
      previousRefreshToken !== ""
        ? previousRefreshToken
        : requiredString(body, "refresh_token");
    const expiresInSeconds =
      body["expires_in"] === undefined
        ? DEFAULT_TOKEN_LIFETIME_SECONDS
        : positiveNumber(body, "expires_in");
    const now = yield* Clock.currentTimeMillis;
    return {
      type: "oauth" as const,
      access,
      refresh,
      expires: now + expiresInSeconds * 1000 - REFRESH_SKEW_MS,
    };
  });

const requestDeviceCode = (signal: AbortSignal): Effect.Effect<XaiDeviceCode> =>
  Effect.gen(function* () {
    const response = yield* postForm(
      XAI_DEVICE_CODE_URL,
      { client_id: XAI_CLIENT_ID, scope: XAI_SCOPE, referrer: "pi" },
      signal,
    );
    if (!response.ok) return yield* Effect.die(requestFailure("device authorization", response));
    return parseDeviceCode(response.body);
  });

const pollTokenOnce = (device: XaiDeviceCode, signal: AbortSignal) =>
  Effect.gen(function* () {
    const response = yield* postForm(
      XAI_TOKEN_URL,
      {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: XAI_CLIENT_ID,
        device_code: device.deviceCode,
      },
      signal,
    );

    if (response.ok) {
      return {
        status: "complete" as const,
        value: yield* credentialsFromTokenResponse(response.body),
      };
    }

    const error = response.body["error"];
    if (error === "authorization_pending") return { status: "pending" as const };
    if (error === "slow_down") {
      const interval = response.body["interval"];
      return {
        status: "slow_down" as const,
        intervalSeconds: typeof interval === "number" ? interval : undefined,
      };
    }
    if (error === "access_denied" || error === "authorization_denied") {
      return { status: "failed" as const, message: "xAI device authorization was denied" };
    }
    if (error === "expired_token") {
      return { status: "failed" as const, message: "xAI device code expired" };
    }
    return {
      status: "failed" as const,
      message: requestFailure("device token polling", response).message,
    };
  });

const pollForTokens = (device: XaiDeviceCode, signal: AbortSignal): Promise<OAuthCredential> =>
  pollOAuthDeviceCodeFlow<OAuthCredential>({
    intervalSeconds: device.intervalSeconds,
    expiresInSeconds: device.expiresInSeconds,
    waitBeforeFirstPoll: true,
    signal,
    poll: () => Effect.runPromise(pollTokenOnce(device, signal)),
  });

const loginXai = (interaction: ProviderAuthInteraction): Promise<OAuthCredential> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const device = yield* requestDeviceCode(interaction.signal);
      interaction.notify({
        type: "device_code",
        userCode: device.userCode,
        verificationUri: device.verificationUriComplete ?? device.verificationUri,
        intervalSeconds: device.intervalSeconds,
        expiresInSeconds: device.expiresInSeconds,
      });
      return yield* Effect.promise(() => pollForTokens(device, interaction.signal));
    }),
  );

const refreshXaiToken = (refreshToken: string, signal: AbortSignal): Promise<OAuthCredential> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const response = yield* postForm(
        XAI_TOKEN_URL,
        { grant_type: "refresh_token", client_id: XAI_CLIENT_ID, refresh_token: refreshToken },
        signal,
      );
      if (!response.ok) return yield* Effect.die(requestFailure("token refresh", response));
      return yield* credentialsFromTokenResponse(response.body, refreshToken);
    }),
  );

export const xaiOAuth: OAuthAuth = {
  name: "xAI (Grok/X subscription)",
  isSubscription: true,
  loginLabel: "Sign in with SuperGrok or X Premium",
  login: loginXai,
  refresh: (credential, signal) => refreshXaiToken(credential.refresh, signal),

  toAuth(credential) {
    return Promise.resolve({ apiKey: credential.access });
  },
};
