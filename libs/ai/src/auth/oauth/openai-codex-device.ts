import { Effect } from "effect";

import type { HttpReply } from "../../utils/http.ts";
import { decodeJson, encodeJson } from "../../utils/json-codec.ts";
import type { OAuthCredential, ProviderAuthInteraction } from "../types.ts";
import { type OAuthDeviceCodePollResult, pollOAuthDeviceCodeFlow } from "./device-code.ts";
import {
  CLIENT_ID,
  DEVICE_CODE_TIMEOUT_SECONDS,
  DEVICE_REDIRECT_URI,
  DEVICE_TOKEN_URL,
  DEVICE_USER_CODE_URL,
  DEVICE_VERIFICATION_URI,
  exchangeAuthorizationCode,
  requestWithLoginCancellation,
} from "./openai-codex-shared.ts";
import { readText } from "./response-json.ts";

const jsonHeaders = { "Content-Type": "application/json" } as const;

interface DeviceAuthInfo {
  readonly deviceAuthId: string;
  readonly userCode: string;
  readonly intervalSeconds: number;
}

interface DeviceTokenSuccess {
  readonly authorizationCode: string;
  readonly codeVerifier: string;
}

const failDeviceAuth = (reply: HttpReply): Effect.Effect<never> =>
  Effect.gen(function* () {
    if (reply.status === 404) {
      return yield* Effect.die(
        new Error(
          "OpenAI Codex device code login is not enabled for this server. Use browser login or verify the server URL.",
        ),
      );
    }
    const responseBody = yield* readText(reply);
    return yield* Effect.die(
      new Error(
        `OpenAI Codex device code request failed with status ${reply.status}${responseBody === "" ? "" : `: ${responseBody}`}`,
      ),
    );
  });

const readDeviceAuthInfo = (
  json: {
    device_auth_id?: string;
    user_code?: string;
    interval?: number | string;
  } | null,
): Effect.Effect<DeviceAuthInfo> =>
  Effect.gen(function* () {
    const intervalSeconds =
      typeof json?.interval === "string" ? Number(json.interval.trim()) : json?.interval;
    if (
      json?.device_auth_id === undefined ||
      json.device_auth_id === "" ||
      json.user_code === undefined ||
      json.user_code === "" ||
      typeof intervalSeconds !== "number" ||
      !Number.isFinite(intervalSeconds) ||
      intervalSeconds < 0
    ) {
      return yield* Effect.die(
        new Error(`Invalid OpenAI Codex device code response: ${yield* encodeJson(json)}`),
      );
    }

    return {
      deviceAuthId: json.device_auth_id,
      userCode: json.user_code,
      intervalSeconds,
    };
  });

const startDeviceAuth = (signal: AbortSignal): Effect.Effect<DeviceAuthInfo> =>
  Effect.gen(function* () {
    const reply = yield* requestWithLoginCancellation({
      url: DEVICE_USER_CODE_URL,
      method: "POST",
      headers: jsonHeaders,
      body: yield* encodeJson({ client_id: CLIENT_ID }),
      signal,
    });
    if (!reply.ok) return yield* failDeviceAuth(reply);
    return yield* readDeviceAuthInfo(
      (yield* reply.json) as {
        device_auth_id?: string;
        user_code?: string;
        interval?: number | string;
      } | null,
    );
  });

const readErrorCode = (responseBody: string): Effect.Effect<unknown> =>
  decodeJson(responseBody).pipe(
    Effect.map((value) => {
      const json = value as { error?: string | { code?: string } } | null;
      const error = json?.error;
      return typeof error === "object" ? error?.code : error;
    }),
    Effect.orElseSucceed(() => undefined),
  );

const readDeviceToken = (
  json: { authorization_code?: string; code_verifier?: string } | null,
): Effect.Effect<OAuthDeviceCodePollResult<DeviceTokenSuccess>> =>
  Effect.gen(function* () {
    if (
      json?.authorization_code === undefined ||
      json.authorization_code === "" ||
      json.code_verifier === undefined ||
      json.code_verifier === ""
    ) {
      return {
        status: "failed",
        message: `Invalid OpenAI Codex device auth token response: ${yield* encodeJson(json)}`,
      };
    }
    return {
      status: "complete",
      value: { authorizationCode: json.authorization_code, codeVerifier: json.code_verifier },
    };
  });

const pollDeviceAuthOnce = (
  device: DeviceAuthInfo,
  signal: AbortSignal,
): Effect.Effect<OAuthDeviceCodePollResult<DeviceTokenSuccess>> =>
  Effect.gen(function* () {
    const reply = yield* requestWithLoginCancellation({
      url: DEVICE_TOKEN_URL,
      method: "POST",
      headers: jsonHeaders,
      body: yield* encodeJson({
        device_auth_id: device.deviceAuthId,
        user_code: device.userCode,
      }),
      signal,
    });

    if (reply.ok) {
      return yield* readDeviceToken(
        (yield* reply.json) as { authorization_code?: string; code_verifier?: string } | null,
      );
    }

    if (reply.status === 403 || reply.status === 404) return { status: "pending" };

    const responseBody = yield* readText(reply);
    const errorCode = yield* readErrorCode(responseBody);
    if (errorCode === "deviceauth_authorization_pending") return { status: "pending" };
    if (errorCode === "slow_down") return { status: "slow_down" };

    return {
      status: "failed",
      message: `OpenAI Codex device auth failed with status ${reply.status}${responseBody === "" ? "" : `: ${responseBody}`}`,
    };
  });

export const loginWithDeviceCode = (
  interaction: ProviderAuthInteraction,
): Effect.Effect<OAuthCredential> =>
  Effect.gen(function* () {
    const runPoll = Effect.runPromiseWith(yield* Effect.context<never>());
    const device = yield* startDeviceAuth(interaction.signal);
    interaction.notify({
      type: "device_code",
      userCode: device.userCode,
      verificationUri: DEVICE_VERIFICATION_URI,
      intervalSeconds: device.intervalSeconds,
      expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
    });
    const code = yield* Effect.promise(() =>
      pollOAuthDeviceCodeFlow<DeviceTokenSuccess>({
        intervalSeconds: device.intervalSeconds,
        expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
        signal: interaction.signal,
        poll: () => runPoll(pollDeviceAuthOnce(device, interaction.signal)),
      }),
    );
    return yield* exchangeAuthorizationCode({
      code: code.authorizationCode,
      verifier: code.codeVerifier,
      redirectUri: DEVICE_REDIRECT_URI,
      signal: interaction.signal,
    });
  });
