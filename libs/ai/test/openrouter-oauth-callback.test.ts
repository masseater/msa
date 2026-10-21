import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import loopbackFetch from "./loopback-fetch.ts";
import openrouterOauthSupport from "./openrouter-oauth-support.ts";

const {
  callbackUrlOf,
  jsonResponse,
  loginThroughCallback,
  restoreStubsAfterEach,
  stubTokenExchange,
} = openrouterOauthSupport;

const reportsExchangeFailure = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      stubTokenExchange(() => jsonResponse({ error: { message: "invalid code" } }, 403));
      const run = loginThroughCallback("bad-code");
      yield* Effect.promise(() =>
        expect(run.login).rejects.toThrow(
          "OpenRouter OAuth key exchange failed (HTTP 403): invalid code",
        ),
      );
      expect((yield* Effect.promise(() => run.callbackResponse)).status).toBe(502);
    }),
  );

const allowsOneExchangePerCallback = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const exchange = Promise.withResolvers<Response>();
      const { fetchMock } = stubTokenExchange(() => exchange.promise);
      const run = loginThroughCallback("authorization-code");

      yield* Effect.promise(() => vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)));
      const callbackUrl = callbackUrlOf(yield* Effect.promise(() => run.authorizeUrl));
      callbackUrl.searchParams.set("code", "authorization-code");
      expect((yield* Effect.promise(() => loopbackFetch(callbackUrl))).status).toBe(409);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      exchange.resolve(jsonResponse({ key: "sk-or-test" }));

      yield* Effect.promise(() =>
        expect(run.login).resolves.toMatchObject({ access: "sk-or-test" }),
      );
      expect((yield* Effect.promise(() => run.callbackResponse)).status).toBe(200);
    }),
  );

const rejectsResponseWithoutKey = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      stubTokenExchange(() => jsonResponse({ user_id: "user-1" }));
      const run = loginThroughCallback("code-without-key");
      yield* Effect.promise(() =>
        expect(run.login).rejects.toThrow('OpenRouter OAuth response carries no "key"'),
      );
      expect((yield* Effect.promise(() => run.callbackResponse)).status).toBe(502);
    }),
  );

describe("OpenRouter OAuth loopback callback", () => {
  restoreStubsAfterEach();

  it(
    "reports token exchange failures through both the callback page and login",
    reportsExchangeFailure,
  );
  it("allows only one token exchange for a callback", allowsOneExchangePerCallback);
  it("rejects a successful response that does not contain a key", rejectsResponseWithoutKey);
});
