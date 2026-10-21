import { Effect, Exit } from "effect";
import { describe, expect, it } from "vite-plus/test";

import oauth from "../src/oauth/index.ts";
import type oauthTypes from "../src/oauth/index.types.ts";
import webFetch from "./web-fetch.ts";

const { OAuthCallbackServer } = oauth;

const withCallback = <A>(
  options: oauthTypes.OAuthCallbackServerOptions | undefined,
  use: (callback: oauthTypes.OAuthCallbackServer) => Effect.Effect<A>,
) =>
  Effect.acquireUseRelease(
    Effect.promise(() => OAuthCallbackServer.listen(options)),
    use,
    (callback) => Effect.promise(() => callback.close()),
  );

const get = (url: string) => Effect.promise(() => webFetch(new Request(url)));

const ignoreRejection = <A>(promise: Promise<A>): Promise<A> => {
  promise.catch(() => undefined);
  return promise;
};

const rendersPlainText = withCallback(undefined, (callback) =>
  Effect.gen(function* () {
    const pending = callback.waitForCallback("s1");
    const response = yield* get(`${callback.redirectUrl}?code=abc&state=s1`);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(yield* Effect.promise(() => response.text())).toBe(
      "Authorization complete. You may close this window.",
    );
    expect((yield* Effect.promise(() => pending)).code).toBe("abc");
  }),
);

const rejectsOtherPath = withCallback({ extraPaths: ["/callback/server-id"] }, (callback) =>
  Effect.gen(function* () {
    const origin = new URL(callback.redirectUrl).origin;
    const mixedUp = ignoreRejection(callback.waitForCallback("s1", "/callback/server-id"));
    const wrong = yield* get(`${origin}/callback?code=abc&state=s1`);
    expect(wrong.status).toBe(400);
    yield* Effect.promise(() => expect(mixedUp).rejects.toThrow("arrived on another redirect URI"));
    const pending = callback.waitForCallback("s2", "/callback/server-id");
    const right = yield* get(`${origin}/callback/server-id?code=abc&state=s2`);
    expect(right.status).toBe(200);
    expect((yield* Effect.promise(() => pending)).code).toBe("abc");
  }),
);

const pages: oauthTypes.OAuthCallbackPage[] = [];

const rendersPages = withCallback(
  {
    renderPage: (page) => {
      pages.push(page);
      return page.ok ? "<p>ok</p>" : `<p>${page.message}</p>`;
    },
  },
  (callback) =>
    Effect.gen(function* () {
      const denied = ignoreRejection(callback.waitForCallback("s1"));
      const failure = yield* get(
        `${callback.redirectUrl}?error=access_denied&error_description=Denied&state=s1`,
      );
      expect(failure.headers.get("content-type")).toBe("text/html; charset=utf-8");
      yield* Effect.promise(() => expect(denied).rejects.toThrow("Denied"));
      expect(pages.at(-1)).toEqual({
        details: "Denied",
        message: "Authorization failed. You may close this window.",
        ok: false,
      });
      const pending = callback.waitForCallback("s2");
      const success = yield* get(`${callback.redirectUrl}?code=abc&state=s2`);
      expect(yield* Effect.promise(() => success.text())).toBe("<p>ok</p>");
      expect((yield* Effect.promise(() => pending)).code).toBe("abc");
    }),
);

const rejectsTakenPort = withCallback(undefined, (callback) =>
  Effect.gen(function* () {
    const port = Number(new URL(callback.redirectUrl).port);
    const second = yield* Effect.exit(
      Effect.tryPromise(() => OAuthCallbackServer.listen({ port })),
    );
    expect(Exit.isFailure(second)).toBe(true);
  }),
);

describe("OAuthCallbackServer pages", () => {
  it("renders plain text by default", () => Effect.runPromise(rendersPlainText));
  it("rejects a response on another path than the expected one", () =>
    Effect.runPromise(rejectsOtherPath));
  it("renders pages through renderPage", () => Effect.runPromise(rendersPages));
  it("fails to listen on a port that is already taken", () => Effect.runPromise(rejectsTakenPort));
});
