import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiCodexOauthSupport from "./openai-codex-oauth-support.ts";

const {
  advanceTimers,
  createAccessToken,
  deviceAuthPendingResponse,
  deviceAuthorization,
  failureOf,
  jsonResponse,
  loginWithDeviceCode,
  respondInTurn,
  restoreAfterEach,
  stubOpenAIAuth,
  untilFirstPoll,
} = openaiCodexOauthSupport;

const cancelsWhileWaiting = () => {
  const controller = new AbortController();
  return Effect.runPromise(
    Effect.gen(function* () {
      vi.useFakeTimers();
      const auth = stubOpenAIAuth({ interval: "5", poll: deviceAuthPendingResponse });
      const { login } = loginWithDeviceCode(controller.signal);
      const failure = failureOf(login);

      yield* untilFirstPoll(auth.pollTimes);
      expect(auth.pollTimes).toHaveLength(1);
      controller.abort();
      expect(yield* failure).toEqual(new Error("Login cancelled"));
    }),
  );
};

const timesOutAfterFifteenMinutes = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      vi.useFakeTimers();
      const auth = stubOpenAIAuth({ interval: "60", poll: deviceAuthPendingResponse });
      const { login } = loginWithDeviceCode();
      const failure = failureOf(login);

      yield* untilFirstPoll(auth.pollTimes);
      expect(auth.pollTimes).toHaveLength(1);
      yield* advanceTimers(15 * 60 * 1000);
      expect(yield* failure).toEqual(new Error("Device flow timed out"));
    }),
  );

const treats403And404AsPending = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      vi.useFakeTimers();
      const accessToken = createAccessToken("account-403-404");
      const auth = stubOpenAIAuth({
        accessToken,
        interval: "1",
        poll: respondInTurn([
          jsonResponse({ error: "access_denied", error_description: "denied" }, 403),
          new Response("not ready", { headers: { "Content-Type": "text/plain" }, status: 404 }),
          deviceAuthorization(),
        ]),
      });
      const { login } = loginWithDeviceCode();

      yield* untilFirstPoll(auth.pollTimes);
      yield* advanceTimers(1000);
      yield* advanceTimers(1000);
      yield* Effect.promise(() =>
        expect(login).resolves.toMatchObject({
          access: accessToken,
          accountId: "account-403-404",
          refresh: "refresh-token",
        }),
      );
      expect(auth.pollTimes).toHaveLength(3);
    }),
  );

const includesPollFailureBody = () => {
  stubOpenAIAuth({
    interval: "5",
    poll: () => jsonResponse({ error: "server_error", error_description: "try again later" }, 500),
  });
  return expect(loginWithDeviceCode().login).rejects.toThrow(
    'OpenAI Codex device auth failed with status 500: {"error":"server_error","error_description":"try again later"}',
  );
};

describe("OpenAI Codex OAuth device code", () => {
  restoreAfterEach();

  it("cancels the OpenAI Codex device code flow while waiting", cancelsWhileWaiting);
  it("times out the OpenAI Codex device code flow after 15 minutes", timesOutAfterFifteenMinutes);
  it("treats OpenAI Codex device auth 403 and 404 responses as pending", treats403And404AsPending);
  it(
    "includes the response body in OpenAI Codex device auth poll failures",
    includesPollFailureBody,
  );
});
