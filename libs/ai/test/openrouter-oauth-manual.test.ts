import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { openRouterOAuth } from "../src/auth/oauth/openrouter.ts";
import openrouterOauthSupport from "./openrouter-oauth-support.ts";

const { jsonResponse, neverAbortedSignal, permanentKey, restoreStubsAfterEach, stubTokenExchange } =
  openrouterOauthSupport;

const mintsKeyFromPastedRedirect = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { exchanges, fetchMock } = stubTokenExchange(() =>
        jsonResponse({ key: "sk-or-manual" }),
      );
      const callbackUrl = Promise.withResolvers<string>();
      const credential = yield* Effect.promise(() =>
        openRouterOAuth.login({
          notify: (event) => {
            if (event.type !== "auth_url") return;
            callbackUrl.resolve(new URL(event.url).searchParams.get("callback_url") ?? "");
          },
          prompt: (prompt) =>
            prompt.type === "manual_code"
              ? callbackUrl.promise.then((url) => `${url}?code=manual-code`)
              : Promise.reject(new Error(`Unexpected prompt: ${prompt.type}`)),
          signal: neverAbortedSignal,
        }),
      );

      expect(credential).toEqual(permanentKey("sk-or-manual"));
      expect(yield* exchanges).toEqual([
        expect.objectContaining({ code: "manual-code", code_challenge_method: "S256" }),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }),
  );

const acceptsBareCode = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { exchanges } = stubTokenExchange(() => jsonResponse({ key: "sk-or-manual" }));
      const credential = yield* Effect.promise(() =>
        openRouterOAuth.login({
          notify: () => {},
          prompt: () => Promise.resolve("  manual-code  "),
          signal: neverAbortedSignal,
        }),
      );
      expect(credential).toMatchObject({ access: "sk-or-manual" });
      expect(yield* exchanges).toEqual([expect.objectContaining({ code: "manual-code" })]);
    }),
  );

const failsWithoutExchanging = (manualInput: () => Promise<string>, message: string) => () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { fetchMock } = stubTokenExchange(() => jsonResponse({ key: "sk-or-unexpected" }));
      yield* Effect.promise(() =>
        expect(
          openRouterOAuth.login({
            notify: () => {},
            prompt: manualInput,
            signal: neverAbortedSignal,
          }),
        ).rejects.toThrow(message),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );

describe("OpenRouter OAuth manual code", () => {
  restoreStubsAfterEach();

  it(
    "mints a key from a pasted redirect URL when the loopback callback never arrives",
    mintsKeyFromPastedRedirect,
  );
  it("accepts a bare authorization code from the manual prompt", acceptsBareCode);
  it(
    "fails login when the manual prompt is cancelled",
    failsWithoutExchanging(() => Promise.reject(new Error("Login cancelled")), "Login cancelled"),
  );
  it(
    "rejects empty manual input without exchanging a code",
    failsWithoutExchanging(() => Promise.resolve("   "), "Missing authorization code"),
  );
});
