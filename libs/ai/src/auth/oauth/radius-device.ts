import { Effect } from "effect";

import { httpRequest } from "../../utils/http.ts";
import type { OAuthCredential, ProviderAuthInteraction } from "../types.ts";
import { type OAuthDeviceCodePollResult, pollOAuthDeviceCodeFlow } from "./device-code.ts";
import {
  type DeviceAuthorizationResponse,
  OAUTH_CLIENT_ID,
  OAUTH_DEVICE_CODE_GRANT_TYPE,
  OAUTH_SCOPE,
} from "./radius-shared.ts";
import { readOAuthResponseError, requestOAuthToken } from "./radius-token.ts";

const requireDeviceAuthorization = (
  data: Partial<DeviceAuthorizationResponse>,
): Effect.Effect<DeviceAuthorizationResponse> =>
  Effect.gen(function* () {
    if (
      data.device_code === undefined ||
      data.device_code === "" ||
      data.user_code === undefined ||
      data.user_code === "" ||
      data.verification_uri === undefined ||
      data.verification_uri === "" ||
      data.expires_in === undefined ||
      data.expires_in === 0 ||
      Number.isNaN(data.expires_in)
    ) {
      return yield* Effect.die(
        new Error("Radius OAuth device authorization response is missing required fields"),
      );
    }
    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      expires_in: data.expires_in,
      interval: data.interval,
    };
  });

const requestDeviceAuthorization = (
  gateway: string,
  signal: AbortSignal,
): Effect.Effect<DeviceAuthorizationResponse> =>
  Effect.gen(function* () {
    const reply = yield* httpRequest({
      url: new URL("/v1/oauth/device", gateway),
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, scope: OAUTH_SCOPE }).toString(),
      signal,
    }).pipe(
      Effect.catchDefect((error) =>
        Effect.die(
          signal.aborted ? new Error("Login cancelled", { cause: error }) : (error as Error),
        ),
      ),
    );

    if (!reply.ok) {
      return yield* Effect.die(
        yield* readOAuthResponseError({
          reply,
          message: "Radius OAuth device authorization failed",
        }),
      );
    }

    return yield* requireDeviceAuthorization(
      (yield* reply.json) as Partial<DeviceAuthorizationResponse>,
    );
  });

const pollDeviceToken = (
  gateway: string,
  device: DeviceAuthorizationResponse,
  signal: AbortSignal,
): Effect.Effect<OAuthDeviceCodePollResult<OAuthCredential>> =>
  requestOAuthToken({
    gateway,
    body: new URLSearchParams({
      grant_type: OAUTH_DEVICE_CODE_GRANT_TYPE,
      client_id: OAUTH_CLIENT_ID,
      device_code: device.device_code,
    }),
    signal,
  }).pipe(
    Effect.map((credentials): OAuthDeviceCodePollResult<OAuthCredential> => ({
      status: "complete",
      value: credentials,
    })),
    Effect.catchTag(
      "RadiusOAuthResponseError",
      (error): Effect.Effect<OAuthDeviceCodePollResult<OAuthCredential>> => {
        switch (error.oauthError) {
          case "authorization_pending":
            return Effect.succeed({ status: "pending" });
          case "slow_down":
            return Effect.succeed({ status: "slow_down" });
          case "expired_token":
            return Effect.succeed({ status: "failed", message: "Device authorization expired." });
          case "access_denied":
            return Effect.succeed({
              status: "failed",
              message: "Device authorization was denied.",
            });
          default:
            return Effect.die(error);
        }
      },
    ),
  );

export interface DeviceCodeLogin {
  readonly gateway: string;
  readonly interaction: ProviderAuthInteraction;
}

export const loginWithDeviceCode = ({
  gateway,
  interaction,
}: DeviceCodeLogin): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const runPoll = Effect.runPromiseWith(yield* Effect.context<never>());
    const device = yield* requestDeviceAuthorization(gateway, interaction.signal);
    interaction.notify({
      type: "device_code",
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      intervalSeconds: device.interval,
      expiresInSeconds: device.expires_in,
    });

    return yield* Effect.promise(() =>
      pollOAuthDeviceCodeFlow<OAuthCredential>({
        intervalSeconds: device.interval,
        expiresInSeconds: device.expires_in,
        signal: interaction.signal,
        poll: () => runPoll(pollDeviceToken(gateway, device, interaction.signal)),
      }),
    );
  });
