import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { McpClient, StreamableHttpTransport } from "../src/index.ts";
import {
  adaptOAuthProvider,
  authorizeMcp,
  McpOAuthAuthorizationRequiredError,
  OAuthCallbackServer,
} from "../src/oauth/index.ts";
import {
  closeServers,
  type HttpRequest,
  type HttpResponse,
  listen,
  readBody,
  readMessage,
  send,
} from "./helpers.ts";
import {
  authorizationServerMetadata,
  endWith,
  sendJson,
  TestOAuthProvider,
} from "./oauth-support.ts";

interface FlowState {
  expectedChallenge: string | undefined;
  refreshes: number;
}

const sha256 = (text: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).pipe(
    Effect.map((digest) => Buffer.from(digest).toString("base64url")),
  );

const redirectWithCode = (url: URL, response: HttpResponse, state: FlowState) =>
  Effect.sync(() => {
    state.expectedChallenge = url.searchParams.get("code_challenge") ?? undefined;
    const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
    redirect.searchParams.set("code", "test-code");
    redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
    response.writeHead(302, { location: redirect.href }).end();
  });

const issueToken = (request: HttpRequest, response: HttpResponse, state: FlowState) =>
  Effect.gen(function* () {
    const params = new URLSearchParams(yield* readBody(request));
    if (params.get("grant_type") === "refresh_token") {
      state.refreshes++;
      return yield* sendJson(response, 200, {
        access_token: "refreshed-token",
        token_type: "Bearer",
        refresh_token: "",
        expires_in: null,
      });
    }
    const challenge = yield* sha256(params.get("code_verifier") ?? "");
    if (params.get("code") !== "test-code" || challenge !== state.expectedChallenge)
      return yield* sendJson(response, 400, { error: "invalid_grant" });
    yield* sendJson(response, 200, {
      access_token: "first-token",
      refresh_token: "refresh-token",
      token_type: "Bearer",
      scope: "",
    });
  });

const serveMcp = (request: HttpRequest, response: HttpResponse, origin: string) =>
  Effect.gen(function* () {
    if (request.method === "GET") return yield* endWith(response, 405);
    if (request.method === "DELETE") return yield* endWith(response, 200);
    const token = request.headers.authorization;
    if (token !== "Bearer first-token" && token !== "Bearer refreshed-token") {
      yield* readBody(request);
      response.writeHead(401, {
        "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope=""`,
      });
      response.end("Unauthorized");
      return;
    }
    const message = yield* readMessage(request);
    if (!("id" in message)) return yield* endWith(response, 202);
    const result =
      message["method"] === "initialize"
        ? {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "oauth-test", version: "1.0.0" },
          }
        : { tools: [{ name: "issues", inputSchema: { type: "object" } }] };
    yield* sendJson(response, 200, { jsonrpc: "2.0", id: message["id"], result });
  });

const register = (request: HttpRequest, response: HttpResponse) =>
  readMessage(request).pipe(
    Effect.flatMap((metadata) =>
      sendJson(response, 201, { ...metadata, client_id: "test-client", client_secret: "" }),
    ),
  );

const flowServer =
  (state: FlowState) => (request: HttpRequest, response: HttpResponse, origin: string) => {
    const url = new URL(request.url ?? "/", origin);
    switch (url.pathname) {
      case "/.well-known/oauth-protected-resource/mcp":
        return sendJson(response, 200, {
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
          scopes_supported: ["org:read"],
        });
      case "/.well-known/oauth-authorization-server":
        return sendJson(response, 200, {
          ...authorizationServerMetadata(origin),
          registration_endpoint: `${origin}/register`,
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
        });
      case "/register":
        return register(request, response);
      case "/authorize":
        return redirectWithCode(url, response, state);
      case "/token":
        return issueToken(request, response, state);
      case "/mcp":
        return serveMcp(request, response, origin);
      default:
        return endWith(response, 404);
    }
  };

const connectPromise = (origin: string, provider: TestOAuthProvider, client: McpClient) =>
  client.connect(
    new StreamableHttpTransport({
      url: `${origin}/mcp`,
      headers: { Authorization: "Bearer caller-supplied-stale-token" },
      authProvider: adaptOAuthProvider(provider),
      openGetStream: false,
    }),
  );

const connectClient = (origin: string, provider: TestOAuthProvider, client: McpClient) =>
  Effect.promise(() => connectPromise(origin, provider, client));

const newClient = () => new McpClient({ name: "oauth-test", version: "1.0.0" });

const completeAuthorization = (
  origin: string,
  provider: TestOAuthProvider,
  callback: OAuthCallbackServer,
) =>
  Effect.gen(function* () {
    const callbackResult = callback.waitForCallback("expected-state");
    const authorizationResponse = yield* Effect.promise(() =>
      send(new Request(provider.authorizationUrl as URL, { redirect: "manual" })),
    );
    yield* Effect.promise(() =>
      send(new Request(authorizationResponse.headers.get("location") as string)),
    );
    const { code } = yield* Effect.promise(() => callbackResult);
    expect(
      yield* authorizeMcp(provider, { serverUrl: `${origin}/mcp`, authorizationCode: code, fetch }),
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
    { name: "issues", inputSchema: { type: "object" } },
  ]);
  yield* Effect.promise(() => client.close());
  provider.tokenSet = { ...provider.tokenSet!, access_token: "stale-token" };
  const refreshedClient = newClient();
  yield* connectClient(origin, provider, refreshedClient);
  expect(provider.tokenSet).toEqual({
    access_token: "refreshed-token",
    refresh_token: "refresh-token",
    token_type: "Bearer",
    scope: "org:read",
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
