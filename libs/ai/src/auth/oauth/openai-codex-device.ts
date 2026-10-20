import { Effect } from "effect";

import type httpTypes from "../../utils/http.types.ts";
import jsonCodec from "../../utils/json-codec.ts";
import type typesModule from "../types.ts";
import deviceCode from "./device-code.ts";
import type deviceCodeTypes from "./device-code.types.ts";
import openaiCodexShared from "./openai-codex-shared.ts";
import responseJson from "./response-json.ts";

const { readText } = responseJson;
const { decodeJson, encodeJson } = jsonCodec;
const {
  CLIENT_ID,
  DEVICE_CODE_TIMEOUT_SECONDS,
  DEVICE_REDIRECT_URI,
  DEVICE_TOKEN_URL,
  DEVICE_USER_CODE_URL,
  DEVICE_VERIFICATION_URI,
  exchangeAuthorizationCode,
  requestWithLoginCancellation,
} = openaiCodexShared;
const { pollOAuthDeviceCodeFlow } = deviceCode;

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

const failDeviceAuth = (reply: httpTypes.HttpReply): Effect.Effect<never> =>
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
      intervalSeconds,
      userCode: json.user_code,
    };
  });

const startDeviceAuth = (signal: AbortSignal): Effect.Effect<DeviceAuthInfo> =>
  Effect.gen(function* () {
    const reply = yield* requestWithLoginCancellation({
      body: yield* encodeJson({ client_id: CLIENT_ID }),
      headers: jsonHeaders,
      method: "POST",
      signal,
      url: DEVICE_USER_CODE_URL,
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
): Effect.Effect<deviceCodeTypes.OAuthDeviceCodePollResult<DeviceTokenSuccess>> =>
  Effect.gen(function* () {
    if (
      json?.authorization_code === undefined ||
      json.authorization_code === "" ||
      json.code_verifier === undefined ||
      json.code_verifier === ""
    ) {
      return {
        message: `Invalid OpenAI Codex device auth token response: ${yield* encodeJson(json)}`,
        status: "failed",
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
): Effect.Effect<deviceCodeTypes.OAuthDeviceCodePollResult<DeviceTokenSuccess>> =>
  Effect.gen(function* () {
    const reply = yield* requestWithLoginCancellation({
      body: yield* encodeJson({
        device_auth_id: device.deviceAuthId,
        user_code: device.userCode,
      }),
      headers: jsonHeaders,
      method: "POST",
      signal,
      url: DEVICE_TOKEN_URL,
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
      message: `OpenAI Codex device auth failed with status ${reply.status}${responseBody === "" ? "" : `: ${responseBody}`}`,
      status: "failed",
    };
  });

const loginWithDeviceCode = (
  interaction: typesModule.ProviderAuthInteraction,
): Effect.Effect<typesModule.OAuthCredential> =>
  Effect.gen(function* () {
    const runPoll = Effect.runPromiseWith(yield* Effect.context<never>());
    const device = yield* startDeviceAuth(interaction.signal);
    interaction.notify({
      expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
      intervalSeconds: device.intervalSeconds,
      type: "device_code",
      userCode: device.userCode,
      verificationUri: DEVICE_VERIFICATION_URI,
    });
    const code = yield* Effect.promise(() =>
      pollOAuthDeviceCodeFlow<DeviceTokenSuccess>({
        expiresInSeconds: DEVICE_CODE_TIMEOUT_SECONDS,
        intervalSeconds: device.intervalSeconds,
        poll: () => runPoll(pollDeviceAuthOnce(device, interaction.signal)),
        signal: interaction.signal,
      }),
    );
    return yield* exchangeAuthorizationCode({
      code: code.authorizationCode,
      redirectUri: DEVICE_REDIRECT_URI,
      signal: interaction.signal,
      verifier: code.codeVerifier,
    });
  });

const openaiCodexDevice = {
  loginWithDeviceCode,
};

export default openaiCodexDevice;
