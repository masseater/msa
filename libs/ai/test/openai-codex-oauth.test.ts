import { DateTime, Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiCodex from "../src/auth/oauth/openai-codex.ts";
import jsonCodec from "./json-codec.ts";
import openaiCodexOauthSupport from "./openai-codex-oauth-support.ts";

const { openaiCodexOAuth } = openaiCodex;

const { decodeJson } = jsonCodec;
const {
  CLIENT_ID,
  advanceTimers,
  createAccessToken,
  deviceAuthPendingResponse,
  deviceAuthorization,
  loginWithDeviceCode,
  neverAbortedSignal,
  respondInTurn,
  restoreAfterEach,
  stubOpenAIAuth,
  untilFirstPoll,
  urls,
} = openaiCodexOauthSupport;

const deviceInfo = (userCode: string) => ({
  expiresInSeconds: 900,
  intervalSeconds: 5,
  userCode,
  verificationUri: "https://auth.openai.com/codex/device",
});

const expectDeviceFlowRequests = (
  requests: readonly { body: string; headers: unknown; method: string | undefined; url: string }[],
) =>
  Effect.gen(function* () {
    for (const request of requests) {
      expect(request.method).toBe("POST");
      if (request.url === urls.OAUTH_TOKEN_URL) continue;
      expect(request.headers).toMatchObject({ "content-type": "application/json" });
      expect(yield* decodeJson(request.body)).toEqual(
        request.url === urls.USERCODE_URL
          ? { client_id: CLIENT_ID }
          : { device_auth_id: "device-auth-id", user_code: "ABCD-1234" },
      );
    }
  });

const logsInWithDeviceCode = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      vi.useFakeTimers();
      const startTime = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-05-20T00:00:00Z"));
      vi.setSystemTime(startTime);
      const accessToken = createAccessToken("account-123");
      const auth = stubOpenAIAuth({
        accessToken,
        interval: "5",
        poll: respondInTurn([deviceAuthPendingResponse(), deviceAuthorization()]),
      });
      const { deviceInfos, login } = loginWithDeviceCode();

      yield* untilFirstPoll(auth.pollTimes);
      expect(deviceInfos).toEqual([deviceInfo("ABCD-1234")]);
      yield* advanceTimers(4999);
      expect(auth.pollTimes).toEqual([startTime]);
      yield* advanceTimers(1);
      yield* Effect.promise(() =>
        expect(login).resolves.toMatchObject({
          access: accessToken,
          accountId: "account-123",
          expires: startTime + 5000 + 3600 * 1000,
          refresh: "refresh-token",
        }),
      );
      expect(auth.pollTimes).toEqual([startTime, startTime + 5000]);
      yield* expectDeviceFlowRequests(auth.requests);
      expect(Object.fromEntries(auth.exchanges[0] ?? [])).toEqual({
        client_id: CLIENT_ID,
        code: "oauth-code",
        code_verifier: "device-code-verifier",
        grant_type: "authorization_code",
        redirect_uri: "https://auth.openai.com/deviceauth/callback",
      });
    }),
  );

const offersBrowserLoginFirst = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const accessToken = createAccessToken("account-456");
      stubOpenAIAuth({
        accessToken,
        interval: "5",
        poll: respondInTurn([deviceAuthorization()]),
        userCode: "WXYZ-7890",
      });
      const selectPrompts: unknown[] = [];
      const deviceInfos: unknown[] = [];
      const credential = yield* Effect.promise(() =>
        openaiCodexOAuth.login({
          notify: (event) => {
            if (event.type === "auth_url") throw new Error("Browser login should not start");
            if (event.type === "device_code") deviceInfos.push(event);
          },
          prompt: (prompt) => {
            if (prompt.type !== "select") {
              return Promise.reject(new Error("Text prompt should not be used"));
            }
            selectPrompts.push(prompt);
            return Promise.resolve("device_code");
          },
          signal: neverAbortedSignal,
        }),
      );
      expect(credential).toMatchObject({ access: accessToken, accountId: "account-456" });
      expect(selectPrompts).toEqual([
        {
          message: "Select OpenAI Codex login method:",
          options: [
            { id: "browser", label: "Browser login (default)" },
            { id: "device_code", label: "Device code login (headless)" },
          ],
          type: "select",
        },
      ]);
      expect(deviceInfos).toEqual([{ ...deviceInfo("WXYZ-7890"), type: "device_code" }]);
    }),
  );

const cancelsMethodSelection = () =>
  expect(
    openaiCodexOAuth.login({
      notify: () => {},
      prompt: () => Promise.reject(new Error("Login cancelled")),
      signal: neverAbortedSignal,
    }),
  ).rejects.toThrow("Login cancelled");

describe("OpenAI Codex OAuth", () => {
  restoreAfterEach();

  it("logs in with the OpenAI Codex device code flow", logsInWithDeviceCode);
  it(
    "offers browser login first and uses the selected OpenAI Codex device code flow",
    offersBrowserLoginFirst,
  );
  it("cancels when OpenAI Codex login method selection is cancelled", cancelsMethodSelection);
});
