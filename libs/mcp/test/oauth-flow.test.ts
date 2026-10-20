import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import mcp from "../src/index.ts";
import type mcpTypes from "../src/index.types.ts";
import oauth from "../src/oauth/index.ts";
import type oauthTypes from "../src/oauth/index.types.ts";
import oauthSupport from "./oauth-support.ts";
import type oauthSupportTypes from "./oauth-support.types.ts";
import webFetch from "./web-fetch.ts";

const { McpClient, StreamableHttpTransport } = mcp;
const {
  McpOAuthAuthorizationRequiredError,
  OAuthCallbackServer,
  adaptOAuthProvider,
  authorizeMcp,
} = oauth;

const { closeServers, listen, readBody, readMessage } = testing;
const { TestOAuthProvider, authorizationServerMetadata, endWith, sendJson } = oauthSupport;

interface FlowState {
  expectedChallenge: string | undefined;
  refreshes: number;
}

const sha256 = (text: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).pipe(
    Effect.map((digest) => Buffer.from(digest).toString("base64url")),
  );

const redirectWithCode = (url: URL, state: FlowState) =>
  Effect.sync(() => {
    state.expectedChallenge = url.searchParams.get("code_challenge") ?? undefined;
    const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
    redirect.searchParams.set("code", "test-code");
    redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
    return new Response(null, { headers: { location: redirect.href }, status: 302 });
  });

const issueToken = (request: Request, state: FlowState) =>
  Effect.gen(function* () {
    const params = new URLSearchParams(yield* readBody(request));
    if (params.get("grant_type") === "refresh_token") {
      state.refreshes++;
      return yield* sendJson(200, {
        access_token: "refreshed-token",
        expires_in: null,
        refresh_token: "",
        token_type: "Bearer",
      });
    }
    const challenge = yield* sha256(params.get("code_verifier") ?? "");
    if (params.get("code") !== "test-code" || challenge !== state.expectedChallenge)
      return yield* sendJson(400, { error: "invalid_grant" });
    return yield* sendJson(200, {
      access_token: "first-token",
      refresh_token: "refresh-token",
      scope: "",
      token_type: "Bearer",
    });
  });

const serveMcp = (request: Request, origin: string) =>
  Effect.gen(function* () {
    if (request.method === "GET") return yield* endWith(405);
    if (request.method === "DELETE") return yield* endWith(200);
    const token = request.headers.get("authorization");
    if (token !== "Bearer first-token" && token !== "Bearer refreshed-token") {
      yield* readBody(request);
      return new Response("Unauthorized", {
        headers: {
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope=""`,
        },
        status: 401,
      });
    }
    const message = yield* readMessage(request);
    if (!("id" in message)) return yield* endWith(202);
    const result =
      message["method"] === "initialize"
        ? {
            capabilities: { tools: {} },
            protocolVersion: "2025-06-18",
            serverInfo: { name: "oauth-test", version: "1.0.0" },
          }
        : { tools: [{ inputSchema: { type: "object" }, name: "issues" }] };
    return yield* sendJson(200, { id: message["id"], jsonrpc: "2.0", result });
  });

const register = (request: Request) =>
  readMessage(request).pipe(
    Effect.flatMap((metadata) =>
      sendJson(201, { ...metadata, client_id: "test-client", client_secret: "" }),
    ),
  );

const flowServer = (state: FlowState) => (request: Request, origin: string) => {
  const url = new URL(request.url);
  switch (url.pathname) {
    case "/.well-known/oauth-protected-resource/mcp":
      return sendJson(200, {
        authorization_servers: [origin],
        resource: `${origin}/mcp`,
        scopes_supported: ["org:read"],
      });
    case "/.well-known/oauth-authorization-server":
      return sendJson(200, {
        ...authorizationServerMetadata(origin),
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        registration_endpoint: `${origin}/register`,
        token_endpoint_auth_methods_supported: ["none"],
      });
    case "/register":
      return register(request);
    case "/authorize":
      return redirectWithCode(url, state);
    case "/token":
      return issueToken(request, state);
    case "/mcp":
      return serveMcp(request, origin);
    default:
      return endWith(404);
  }
};

const connectPromise = (
  origin: string,
  provider: oauthSupportTypes.TestOAuthProvider,
  client: mcpTypes.McpClient,
) =>
  client.connect(
    new StreamableHttpTransport({
      authProvider: adaptOAuthProvider(provider),
      headers: { Authorization: "Bearer caller-supplied-stale-token" },
      openGetStream: false,
      url: `${origin}/mcp`,
    }),
  );

const connectClient = (
  origin: string,
  provider: oauthSupportTypes.TestOAuthProvider,
  client: mcpTypes.McpClient,
) => Effect.promise(() => connectPromise(origin, provider, client));

const newClient = () => new McpClient({ name: "oauth-test", version: "1.0.0" });

const completeAuthorization = (
  origin: string,
  provider: oauthSupportTypes.TestOAuthProvider,
  callback: oauthTypes.OAuthCallbackServer,
) =>
  Effect.gen(function* () {
    const callbackResult = callback.waitForCallback("expected-state");
    const authorizationResponse = yield* Effect.promise(() =>
      webFetch(new Request(provider.authorizationUrl as URL, { redirect: "manual" })),
    );
    yield* Effect.promise(() =>
      webFetch(new Request(authorizationResponse.headers.get("location") as string)),
    );
    const { code } = yield* Effect.promise(() => callbackResult);
    expect(
      yield* authorizeMcp(provider, { authorizationCode: code, fetch, serverUrl: `${origin}/mcp` }),
    ).toBe("AUTHORIZED");
  });

const authorizesAndRefreshes = Effect.gen(function* () {
  const state: FlowState = { expectedChallenge: undefined, refreshes: 0 };
  const origin = yield* listen(flowServer(state));
  const callback = yield* Effect.promise(() => OAuthCallbackServer.listen());
  const provider = new TestOAuthProvider(callback.redirectUrl);
  yield* Effect.promise(() =>
    expect(connectPromise(origin, provider, newClient())).rejects.toBeInstanceOf(
      McpOAuthAuthorizationRequiredError,
    ),
  );
  expect(provider.authorizationUrl?.searchParams.get("scope")).toBe("org:read");
  expect(provider.authorizationUrl?.searchParams.get("resource")).toBe(`${origin}/mcp`);
  yield* completeAuthorization(origin, provider, callback);
  const client = newClient();
  yield* connectClient(origin, provider, client);
  expect(yield* Effect.promise(() => client.listTools())).toEqual([
    { inputSchema: { type: "object" }, name: "issues" },
  ]);
  yield* Effect.promise(() => client.close());
  provider.tokenSet = { ...provider.tokenSet!, access_token: "stale-token" };
  const refreshedClient = newClient();
  yield* connectClient(origin, provider, refreshedClient);
  expect(provider.tokenSet).toEqual({
    access_token: "refreshed-token",
    refresh_token: "refresh-token",
    scope: "org:read",
    token_type: "Bearer",
  });
  expect(state.refreshes).toBe(1);
  yield* Effect.promise(() => refreshedClient.close());
  yield* Effect.promise(() => callback.close());
});

afterEach(() => Effect.runPromise(closeServers));

describe("MCP OAuth flow", () => {
  it("discovers, registers, authorizes with PKCE, and refreshes on 401", () =>
    Effect.runPromise(authorizesAndRefreshes));
});
