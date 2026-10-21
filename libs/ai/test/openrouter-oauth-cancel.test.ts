import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import openrouter from "../src/auth/oauth/openrouter.ts";
import loopbackFetch from "./loopback-fetch.ts";
import openrouterOauthSupport from "./openrouter-oauth-support.ts";

const { openRouterOAuth } = openrouter;

const { cancelAtAuthUrl, restoreStubsAfterEach } = openrouterOauthSupport;

const closesPendingCallback = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const run = cancelAtAuthUrl();
      yield* Effect.promise(() => expect(run.login).rejects.toThrow("Login cancelled"));
      const callbackUrl = yield* Effect.promise(() => run.callbackUrl);
      yield* Effect.promise(() => expect(loopbackFetch(callbackUrl)).rejects.toThrow());
    }),
  );

const rejectsAlreadyCancelledLogin = () =>
  expect(
    openRouterOAuth.login({
      notify: () => {
        throw new Error("Cancelled login must not emit events");
      },
      prompt: () => Promise.resolve(""),
      signal: AbortSignal.abort(),
    }),
  ).rejects.toThrow("Login cancelled");

const usesConfiguredCallbackHost = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      vi.stubEnv("MSA_OAUTH_CALLBACK_HOST", "localhost");
      const run = cancelAtAuthUrl();
      yield* Effect.promise(() => expect(run.login).rejects.toThrow("Login cancelled"));
      expect((yield* Effect.promise(() => run.callbackUrl)).hostname).toBe("localhost");
    }),
  );

describe("OpenRouter OAuth cancellation", () => {
  restoreStubsAfterEach();

  it("closes the pending callback when login is cancelled", closesPendingCallback);
  it(
    "rejects before opening a callback server when login is already cancelled",
    rejectsAlreadyCancelledLogin,
  );
  it("uses the configured OAuth callback host", usesConfiguredCallbackHost);
});
