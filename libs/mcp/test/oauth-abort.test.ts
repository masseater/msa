import { Effect, Fiber } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { authorizeMcp } from "../src/oauth/index.ts";
import { closeServers, listen } from "./helpers.ts";
import { authorizationServerMetadata, originalError, TestOAuthProvider } from "./oauth-support.ts";

const abortController = (): AbortController => new AbortController();

const runAborted = (origin: string, stalled: string[], provider: TestOAuthProvider) =>
  Effect.gen(function* () {
    const controller = abortController();
    const count = stalled.length;
    const flow = yield* Effect.forkChild(
      Effect.flip(
        authorizeMcp(provider, { serverUrl: `${origin}/mcp`, signal: controller.signal }),
      ),
    );
    yield* Effect.promise(() => expect.poll(() => stalled.length).toBe(count + 1));
    controller.abort();
    expect(originalError(yield* Fiber.join(flow))).toMatchObject({ name: "AbortError" });
    expect(provider.authorizationUrl).toBeUndefined();
    return stalled.at(-1);
  });

const stopsOnAbort = Effect.gen(function* () {
  const stalled: string[] = [];
  const origin = yield* listen((request) =>
    Effect.sync(() => {
      stalled.push(new URL(request.url).pathname);
    }).pipe(Effect.andThen(Effect.never)),
  );
  expect(
    yield* runAborted(origin, stalled, new TestOAuthProvider("http://127.0.0.1/callback")),
  ).toBe("/.well-known/oauth-protected-resource/mcp");
  const refreshing = new TestOAuthProvider("http://127.0.0.1/callback");
  refreshing.client = { client_id: "client" };
  refreshing.tokenSet = { access_token: "a1", refresh_token: "r1", token_type: "Bearer" };
  refreshing.discovery = {
    authorizationServerUrl: origin,
    authorizationServerMetadata: authorizationServerMetadata(origin),
  };
  expect(yield* runAborted(origin, stalled, refreshing)).toBe("/token");
});

afterEach(() => Effect.runPromise(closeServers));

describe("MCP OAuth cancellation", () => {
  it("stops when its signal aborts, without falling back to a redirect", () =>
    Effect.runPromise(stopsOnAbort));
});
