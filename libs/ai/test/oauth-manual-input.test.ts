import { Deferred, Effect, Fiber } from "effect";
import { expect, it } from "vite-plus/test";

import { waitForCallbackOrManualInput } from "../src/auth/oauth/callback-server.ts";
import type { AuthPrompt, ProviderAuthInteraction } from "../src/auth/types.ts";
import { expectDefect } from "./effect-assert.ts";
import { callbackUrl, request, start } from "./oauth-callback.ts";

const interaction = (prompt: (prompt: AuthPrompt) => Promise<string>): ProviderAuthInteraction => ({
  signal: new AbortController().signal,
  notify: () => {},
  prompt,
});

const pendingPrompt =
  (onPrompt?: (prompt: AuthPrompt) => void): ((prompt: AuthPrompt) => Promise<string>) =>
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

const startPlain = () => start({ state: undefined, complete: (code) => Effect.succeed(code) });

it("returns the browser callback and aborts the manual prompt", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const prompted = yield* Deferred.make<AbortSignal | undefined>();
        const server = yield* startPlain();
        const result = yield* Effect.forkChild(
          waitForCallbackOrManualInput({
            interaction: interaction(
              pendingPrompt((prompt) => {
                Deferred.doneUnsafe(prompted, Effect.succeed(prompt.signal));
              }),
            ),
            callback: server,
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
          interaction: interaction(() => Promise.resolve("pasted")),
          callback: server,
          message: "paste",
          placeholder: server.redirectUri,
        });
        expect(result).toEqual({ type: "manual", input: "pasted" });
      }),
    ),
  ));

it("uses only the manual prompt without a callback server", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* waitForCallbackOrManualInput({
        interaction: interaction(() => Promise.resolve("pasted")),
        callback: undefined,
        message: "paste",
        placeholder: "http://localhost/callback",
      });
      expect(result).toEqual({ type: "manual", input: "pasted" });
    }),
  ));

it("propagates manual prompt failures", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startPlain();
        yield* expectDefect(
          waitForCallbackOrManualInput({
            interaction: interaction(() => Promise.reject(new Error("prompt cancelled"))),
            callback: server,
            message: "paste",
            placeholder: server.redirectUri,
          }),
          "prompt cancelled",
        );
      }),
    ),
  ));
