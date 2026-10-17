import { Clock, Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  adaptOAuthProvider,
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  MemoryOAuthStateStore,
} from "../src/oauth/index.ts";
import { closeServers, type HttpRequest, type HttpResponse, listen, readBody } from "./helpers.ts";
import {
  authorizationServerMetadata,
  endWith,
  sendJson,
  TestOAuthProvider,
} from "./oauth-support.ts";

const rotateToken = (request: HttpRequest, response: HttpResponse, grants: string[]) =>
  Effect.gen(function* () {
    const params = new URLSearchParams(yield* readBody(request));
    const refreshToken = params.get("refresh_token") ?? "";
    grants.push(refreshToken);
    if (refreshToken !== "r1") return yield* sendJson(response, 400, { error: "invalid_grant" });
    yield* Effect.sleep("20 millis");
    yield* sendJson(response, 200, {
      access_token: "a2",
      refresh_token: "r2",
      token_type: "Bearer",
      expires_in: 3600,
    });
  });

const rotatingServer =
  (grants: string[]) => (request: HttpRequest, response: HttpResponse, origin: string) => {
    const url = new URL(request.url ?? "/", origin);
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp")
      return sendJson(response, 200, {
        resource: `${origin}/mcp`,
        authorization_servers: ["not a url"],
      });
    if (url.pathname === "/.well-known/oauth-authorization-server")
      return sendJson(response, 200, authorizationServerMetadata(origin));
    if (url.pathname === "/token") return rotateToken(request, response, grants);
    return endWith(response, 404);
  };

const sharesOneRefresh = Effect.gen(function* () {
  const grants: string[] = [];
  const origin = yield* listen(rotatingServer(grants));
  const store = new MemoryOAuthStateStore();
  const provider = new McpOAuthProvider({
    serverUrl: `${origin}/mcp`,
    redirectUrl: "http://127.0.0.1/callback",
    clientMetadata: { client_name: "test" },
    clientId: "client",
    store,
    onRedirect: () => undefined,
  });
  yield* Effect.promise(() =>
    provider.saveTokens({ access_token: "a1", refresh_token: "r1", token_type: "Bearer" }),
  );
  const auth = adaptOAuthProvider(provider);
  const unauthorized = () => ({
    response: new Response(null, { status: 401, headers: { "www-authenticate": "Bearer" } }),
    serverUrl: new URL(`${origin}/mcp`),
    fetch,
    token: "a1",
  });
  yield* Effect.promise(() =>
    Promise.all([auth.onUnauthorized?.(unauthorized()), auth.onUnauthorized?.(unauthorized())]),
  );
  yield* Effect.promise(() => Promise.resolve(auth.onUnauthorized?.(unauthorized())));
  expect(grants).toEqual(["r1"]);
  expect(yield* Effect.promise(() => auth.token())).toBe("a2");
  const state = yield* Effect.sync(() => store.load());
  expect(state?.tokens?.refresh_token).toBe("r2");
  expect(state?.tokensExpireAt).toBeGreaterThan((yield* Clock.currentTimeMillis) + 3_500_000);
});

const asksForMoreScope = Effect.gen(function* () {
  const provider = new TestOAuthProvider("http://127.0.0.1/callback");
  provider.client = { client_id: "client" };
  provider.tokenSet = {
    access_token: "a1",
    refresh_token: "r1",
    token_type: "Bearer",
    scope: "repo read:org",
  };
  const origin = yield* listen((request, response, serverOrigin) => {
    const url = new URL(request.url ?? "/", serverOrigin);
    if (url.pathname === "/.well-known/oauth-authorization-server")
      return sendJson(response, 200, authorizationServerMetadata(serverOrigin));
    return endWith(response, url.pathname === "/token" ? 500 : 404);
  });
  const auth = adaptOAuthProvider(provider);
  yield* Effect.promise(() =>
    expect(
      auth.onUnauthorized?.({
        response: new Response(null, {
          status: 403,
          headers: { "www-authenticate": 'Bearer error="insufficient_scope", scope="repo admin"' },
        }),
        serverUrl: new URL(`${origin}/mcp`),
        fetch,
        token: "a1",
      }),
    ).rejects.toBeInstanceOf(McpOAuthAuthorizationRequiredError),
  );
  expect(provider.authorizationUrl?.searchParams.get("scope")).toBe("repo read:org admin");
  expect(provider.tokenSet?.access_token).toBe("a1");
});

const providerFor = (serverUrl: string, store: MemoryOAuthStateStore) =>
  new McpOAuthProvider({
    serverUrl,
    redirectUrl: "http://127.0.0.1/callback",
    clientMetadata: { client_name: "test" },
    store,
    onRedirect: () => undefined,
  });

const bindsCredentials = Effect.gen(function* () {
  const store = new MemoryOAuthStateStore();
  const first = providerFor("https://one.example/mcp", store);
  yield* Effect.promise(() => first.saveTokens({ access_token: "secret", token_type: "Bearer" }));
  expect((yield* Effect.promise(() => first.tokens()))?.access_token).toBe("secret");
  const second = providerFor("https://two.example/mcp", store);
  expect(yield* Effect.promise(() => second.tokens())).toBeUndefined();
});

afterEach(() => Effect.runPromise(closeServers));

describe("MCP OAuth refresh", () => {
  it("shares one refresh between concurrent 401s when refresh tokens rotate", () =>
    Effect.runPromise(sharesOneRefresh));
  it("asks for authorization instead of refreshing when the server needs more scope", () =>
    Effect.runPromise(asksForMoreScope));
  it("binds persisted credentials to the exact MCP server URL", () =>
    Effect.runPromise(bindsCredentials));
});
