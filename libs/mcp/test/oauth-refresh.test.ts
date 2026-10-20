import { Clock, Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  MemoryOAuthStateStore,
  adaptOAuthProvider,
} from "../src/oauth/index.ts";
import helpers from "./helpers.ts";
import oauthSupport from "./oauth-support.ts";

const { closeServers, listen, readBody } = helpers;
const { TestOAuthProvider, authorizationServerMetadata, endWith, sendJson } = oauthSupport;

const rotateToken = (request: Request, grants: string[]) =>
  Effect.gen(function* () {
    const params = new URLSearchParams(yield* readBody(request));
    const refreshToken = params.get("refresh_token") ?? "";
    grants.push(refreshToken);
    if (refreshToken !== "r1") return yield* sendJson(400, { error: "invalid_grant" });
    yield* Effect.sleep("20 millis");
    return yield* sendJson(200, {
      access_token: "a2",
      expires_in: 3600,
      refresh_token: "r2",
      token_type: "Bearer",
    });
  });

const rotatingServer = (grants: string[]) => (request: Request, origin: string) => {
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/oauth-protected-resource/mcp")
    return sendJson(200, {
      authorization_servers: ["not a url"],
      resource: `${origin}/mcp`,
    });
  if (url.pathname === "/.well-known/oauth-authorization-server")
    return sendJson(200, authorizationServerMetadata(origin));
  if (url.pathname === "/token") return rotateToken(request, grants);
  return endWith(404);
};

const sharesOneRefresh = Effect.gen(function* () {
  const grants: string[] = [];
  const origin = yield* listen(rotatingServer(grants));
  const store = new MemoryOAuthStateStore();
  const provider = new McpOAuthProvider({
    clientId: "client",
    clientMetadata: { client_name: "test" },
    onRedirect: () => undefined,
    redirectUrl: "http://127.0.0.1/callback",
    serverUrl: `${origin}/mcp`,
    store,
  });
  yield* Effect.promise(() =>
    provider.saveTokens({ access_token: "a1", refresh_token: "r1", token_type: "Bearer" }),
  );
  const auth = adaptOAuthProvider(provider);
  const unauthorized = () => ({
    fetch,
    response: new Response(null, { headers: { "www-authenticate": "Bearer" }, status: 401 }),
    serverUrl: new URL(`${origin}/mcp`),
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
    scope: "repo read:org",
    token_type: "Bearer",
  };
  const origin = yield* listen((request, serverOrigin) => {
    const url = new URL(request.url);
    if (url.pathname === "/.well-known/oauth-authorization-server")
      return sendJson(200, authorizationServerMetadata(serverOrigin));
    return endWith(url.pathname === "/token" ? 500 : 404);
  });
  const auth = adaptOAuthProvider(provider);
  yield* Effect.promise(() =>
    expect(
      auth.onUnauthorized?.({
        fetch,
        response: new Response(null, {
          headers: { "www-authenticate": 'Bearer error="insufficient_scope", scope="repo admin"' },
          status: 403,
        }),
        serverUrl: new URL(`${origin}/mcp`),
        token: "a1",
      }),
    ).rejects.toBeInstanceOf(McpOAuthAuthorizationRequiredError),
  );
  expect(provider.authorizationUrl?.searchParams.get("scope")).toBe("repo read:org admin");
  expect(provider.tokenSet?.access_token).toBe("a1");
});

const providerFor = (serverUrl: string, store: MemoryOAuthStateStore) =>
  new McpOAuthProvider({
    clientMetadata: { client_name: "test" },
    onRedirect: () => undefined,
    redirectUrl: "http://127.0.0.1/callback",
    serverUrl,
    store,
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
