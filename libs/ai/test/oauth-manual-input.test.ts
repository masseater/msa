import { Deferred, Effect, Fiber } from "effect";
import { expect, it } from "vite-plus/test";

import callbackServer from "../src/auth/oauth/callback-server.ts";
import type typesModule from "../src/auth/types.ts";
import effectAssert from "./effect-assert.ts";
import oauthCallback from "./oauth-callback.ts";

const { waitForCallbackOrManualInput } = callbackServer;

const { expectDefect } = effectAssert;
const { callbackUrl, request, start } = oauthCallback;

const interaction = (
  prompt: (prompt: typesModule.AuthPrompt) => Promise<string>,
): typesModule.ProviderAuthInteraction => ({
  notify: () => {},
  prompt,
  signal: new AbortController().signal,
});

const pendingPrompt =
  (
    onPrompt?: (prompt: typesModule.AuthPrompt) => void,
  ): ((prompt: typesModule.AuthPrompt) => Promise<string>) =>
  (prompt) => {
    onPrompt?.(prompt);
    return Effect.runPromise(
      Effect.callback<string>((resume) => {
        prompt.signal?.addEventListener(
          "abort",
          () => resume(Effect.die(new Error("prompt aborted"))),
          { once: true },
        );
      }),
    );
  };

const startPlain = () => start({ complete: (code) => Effect.succeed(code), state: undefined });

it("returns the browser callback and aborts the manual prompt", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const prompted = yield* Deferred.make<AbortSignal | undefined>();
        const server = yield* startPlain();
        const result = yield* Effect.forkChild(
          waitForCallbackOrManualInput({
            callback: server,
            interaction: interaction(
              pendingPrompt((prompt) => {
                Deferred.doneUnsafe(prompted, Effect.succeed(prompt.signal));
              }),
            ),
            message: "paste",
            placeholder: server.redirectUri,
          }),
        );
        const manualSignal = yield* Deferred.await(prompted);
        yield* request(callbackUrl(server.redirectUri, { code: "from-browser" }));
        expect(yield* Fiber.join(result)).toEqual({ type: "callback", value: "from-browser" });
        expect(manualSignal?.aborted).toBe(true);
      }),
    ),
  ));

it("returns pasted input and stops waiting for the browser", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startPlain();
        const result = yield* waitForCallbackOrManualInput({
          callback: server,
          interaction: interaction(() => Promise.resolve("pasted")),
          message: "paste",
          placeholder: server.redirectUri,
        });
        expect(result).toEqual({ input: "pasted", type: "manual" });
      }),
    ),
  ));

it("uses only the manual prompt without a callback server", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* waitForCallbackOrManualInput({
        callback: undefined,
        interaction: interaction(() => Promise.resolve("pasted")),
        message: "paste",
        placeholder: "http://localhost/callback",
      });
      expect(result).toEqual({ input: "pasted", type: "manual" });
    }),
  ));

it("propagates manual prompt failures", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startPlain();
        yield* expectDefect(
          waitForCallbackOrManualInput({
            callback: server,
            interaction: interaction(() => Promise.reject(new Error("prompt cancelled"))),
            message: "paste",
            placeholder: server.redirectUri,
          }),
          "prompt cancelled",
        );
      }),
    ),
  ));
