import { Effect } from "effect";

import { httpRequest } from "../../utils/http.ts";
import { encodeJson } from "../../utils/json-codec.ts";
import type { OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "../types.ts";
import { type OAuthDeviceCodePollResult, pollOAuthDeviceCodeFlow } from "./device-code.ts";
import { refreshKimiToken } from "./kimi-refresh.ts";
import {
  CLIENT_ID,
  DEFAULT_POLL_INTERVAL_SECONDS,
  DEVICE_CODE_TIMEOUT_SECONDS,
  getOauthHost,
  parseTokenResponse,
  type TokenResponse,
  toCredential,
  tokenUrl,
} from "./kimi-shared.ts";
import {
  formHeaders,
  positiveNumber,
  readJson,
  readText,
  requestSignal,
  trustedHttpUrl,
} from "./response-json.ts";

interface DeviceAuthorization {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string;
  readonly intervalSeconds: number;
  readonly expiresInSeconds: number;
}

const readDeviceAuthorization = (
  json: Record<string, unknown> | null,
): Effect.Effect<DeviceAuthorization> =>
  Effect.gen(function* () {
    const deviceCode = json?.["device_code"];
    const userCode = json?.["user_code"];
    const verificationUri = json?.["verification_uri"];
    const verificationUriComplete = json?.["verification_uri_complete"];
    if (
      typeof deviceCode !== "string" ||
      typeof userCode !== "string" ||
      typeof verificationUri !== "string" ||
      typeof verificationUriComplete !== "string" ||
      trustedHttpUrl(verificationUri) === null ||
      trustedHttpUrl(verificationUriComplete) === null
    ) {
      return yield* Effect.die(
        new Error(`Invalid Kimi Code device authorization response: ${yield* encodeJson(json)}`),
      );
    }
    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete,
      intervalSeconds: positiveNumber(json?.["interval"]) ?? DEFAULT_POLL_INTERVAL_SECONDS,
      expiresInSeconds: positiveNumber(json?.["expires_in"]) ?? DEVICE_CODE_TIMEOUT_SECONDS,
    };
  });

const startDeviceAuthorization = (
  oauthHost: string,
  signal: AbortSignal,
): Effect.Effect<DeviceAuthorization> =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      url: `${oauthHost}/api/oauth/device_authorization`,
      method: "POST",
      headers: formHeaders,
      body: new URLSearchParams({ client_id: CLIENT_ID }).toString(),
      signal: requestSignal(signal),
    });

    if (!reply.ok) {
      const text = yield* readText(reply);
      return yield* Effect.die(
        new Error(
          `Kimi Code device authorization failed with status ${reply.status}${text === "" ? "" : `: ${text}`}`,
        ),
      );
    }

    return yield* readDeviceAuthorization(yield* readJson(reply));
  });

const tokenFailure = (
  reply: { readonly status: number },
  json: Record<string, unknown> | null,
): OAuthDeviceCodePollResult<TokenResponse> => {
  const error = json?.["error"];
  const errorDescription = json?.["error_description"];
  const description = typeof errorDescription === "string" ? `: ${errorDescription}` : "";
  switch (error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down", intervalSeconds: positiveNumber(json?.["interval"]) };
    case "expired_token":
      return {
        status: "failed",
        message: "Kimi Code device authorization expired. Please restart login.",
      };
    case "access_denied":
      return { status: "failed", message: "Kimi Code login was denied." };
    default:
      return {
        status: "failed",
        message: `Kimi Code device token request failed (status ${reply.status})${typeof error === "string" ? `: ${error}${description}` : ""}`,
      };
  }
};

const pollTokenOnce = (
  oauthHost: string,
  device: DeviceAuthorization,
  signal: AbortSignal,
): Effect.Effect<OAuthDeviceCodePollResult<TokenResponse>> =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      url: tokenUrl(oauthHost),
      method: "POST",
      headers: formHeaders,
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        device_code: device.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }).toString(),
      signal: requestSignal(signal),
    });

    if (reply.status >= 500) {
      const text = yield* readText(reply);
      return {
        status: "failed",
        message: `Kimi Code device token request failed with status ${reply.status}${text === "" ? "" : `: ${text}`}`,
      };
    }

    const json = yield* readJson(reply);
    if (reply.ok && typeof json?.["access_token"] === "string") {
      return yield* parseTokenResponse({ json, operation: "poll" }).pipe(
        Effect.map((value): OAuthDeviceCodePollResult<TokenResponse> => ({
          status: "complete",
          value,
        })),
        Effect.catchDefect((error) =>
          Effect.succeed<OAuthDeviceCodePollResult<TokenResponse>>({
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
    }

    return tokenFailure(reply, json);
  });

const loginKimiCoding = (interaction: ProviderAuthInteraction): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const runPoll = Effect.runPromiseWith(yield* Effect.context<never>());
    const oauthHost = getOauthHost();
    const device = yield* startDeviceAuthorization(oauthHost, interaction.signal);
    interaction.notify({
      type: "device_code",
      userCode: device.userCode,
      verificationUri: device.verificationUriComplete,
      intervalSeconds: device.intervalSeconds,
      expiresInSeconds: device.expiresInSeconds,
    });
    const token = yield* Effect.promise(() =>
      pollOAuthDeviceCodeFlow<TokenResponse>({
        intervalSeconds: device.intervalSeconds,
        expiresInSeconds: device.expiresInSeconds,
        waitBeforeFirstPoll: true,
        signal: interaction.signal,
        poll: () => runPoll(pollTokenOnce(oauthHost, device, interaction.signal)),
      }),
    );
    return toCredential(token);
  });

export const kimiCodingOAuth: OAuthAuth = {
  name: "Kimi Code (subscription)",
  isSubscription: true,
  loginLabel: "Sign in with Kimi Code",

  login: (interaction) => Effect.runPromise(loginKimiCoding(interaction)),

  refresh: (credential, signal) =>
    Effect.runPromise(
      refreshKimiToken({ oauthHost: getOauthHost(), refresh: credential.refresh, signal }).pipe(
        Effect.map(toCredential),
      ),
    ),

  toAuth(credential) {
    return Promise.resolve({ headers: { Authorization: `Bearer ${credential.access}` } });
  },
};
