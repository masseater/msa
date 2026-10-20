import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { LATEST_PROTOCOL_VERSION } from "@msa/mcp";
import testing from "@msa/testing";
import { Context, Crypto, Deferred, Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { HttpEffect, HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";

const { fromJsonText } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);

interface StalledRequest {
  path: string;
  request: Request;
}

interface ServerOptions {
  iss?: string;
  issParameter?: boolean;
  cimd?: boolean;
  redirectPath?: string;
}

interface ServerState {
  readonly options: ServerOptions;
  readonly log: string[];
  readonly registrations: Record<string, unknown>[];
  readonly authorizations: URLSearchParams[];
  readonly tokenRequests: URLSearchParams[];
  readonly deletes: (string | undefined)[];
  readonly stall: Set<string>;
  readonly stalled: StalledRequest[];
  readonly validTokens: Set<string>;
  readonly refreshTokens: Set<string>;
  readonly challenges: Map<string, string>;
  readonly closing: Deferred.Deferred<void>;
  issued: number;
  origin: string;
}

interface McpMessage {
  id?: number;
  method: string;
  params?: unknown;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });

const readText = (request: Request): Effect.Effect<string> => Effect.promise(() => request.text());

const readJson = (request: Request): Effect.Effect<unknown> =>
  Effect.flatMap(readText(request), fromJsonText);

const sha256 = (value: string) =>
  Effect.map(
    Crypto.Crypto.use((crypto) => crypto.digest("SHA-256", new TextEncoder().encode(value))),
    (digest) => Buffer.from(digest),
  );

const issueTokens = (state: ServerState) => {
  state.issued += 1;
  const tokens = {
    access_token: `access-${state.issued}`,
    refresh_token: `refresh-${state.issued}`,
  };
  state.validTokens.add(tokens.access_token);
  state.refreshTokens.add(tokens.refresh_token);
  return { ...tokens, expires_in: 3600, token_type: "Bearer" };
};

const mcpResult = (state: ServerState, message: McpMessage, token: string): unknown => {
  switch (message.method) {
    case "initialize":
      return {
        capabilities: { tools: {} },
        protocolVersion: LATEST_PROTOCOL_VERSION,
        serverInfo: { name: "issues", version: "1.0.0" },
      };
    case "tools/list":
      return { tools: [{ inputSchema: { properties: {}, type: "object" }, name: "whoami" }] };
    case "tools/call":
      state.log.push(`call ${token}`);
      return { content: [{ text: `token ${token}`, type: "text" }] };
    default:
      return {};
  }
};

const unauthorized = (state: ServerState, token: string | undefined): Response => {
  state.log.push(`401 ${token ?? "none"}`);
  return new Response(null, {
    headers: {
      "www-authenticate": `Bearer resource_metadata="${state.origin}/.well-known/oauth-protected-resource/mcp"`,
    },
    status: 401,
  });
};

const handleMcp = Effect.fn("handleMcp")(function* (state: ServerState, request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /u, "");
  if (request.method === "DELETE") state.deletes.push(token);
  if (request.method !== "POST") {
    return new Response(null, { status: request.method === "GET" ? 405 : 200 });
  }
  if (token === undefined || token === "" || !state.validTokens.has(token)) {
    return unauthorized(state, token);
  }
  const message = (yield* readJson(request)) as McpMessage;
  if (message.id === undefined) return new Response(null, { status: 202 });
  return json(
    200,
    { id: message.id, jsonrpc: "2.0", result: mcpResult(state, message, token) },
    { "mcp-session-id": "session-1" },
  );
});

const handleToken = Effect.fn("handleToken")(function* (
  state: ServerState,
  params: URLSearchParams,
) {
  state.tokenRequests.push(params);
  if (params.get("grant_type") === "authorization_code") {
    const code = params.get("code") ?? "";
    const challenge = state.challenges.get(code);
    const verifier = (yield* sha256(params.get("code_verifier") ?? "")).toString("base64url");
    if (challenge === undefined || challenge === "" || challenge !== verifier)
      return json(400, { error: "invalid_grant" });
    state.challenges.delete(code);
    state.log.push("token code");
    return json(200, issueTokens(state));
  }
  if (!state.refreshTokens.delete(params.get("refresh_token") ?? ""))
    return json(400, { error: "invalid_grant" });
  state.log.push("token refresh");
  return json(200, issueTokens(state));
});

const authorize = (state: ServerState, url: URL): Response => {
  const { options } = state;
  state.authorizations.push(url.searchParams);
  const code = `code-${state.challenges.size + 1}`;
  state.challenges.set(code, url.searchParams.get("code_challenge") ?? "");
  const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
  if (options.redirectPath !== undefined && options.redirectPath !== "")
    redirect.pathname = options.redirectPath;
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
  const iss = options.iss ?? (options.issParameter === true ? state.origin : undefined);
  if (iss !== undefined && iss !== "") redirect.searchParams.set("iss", iss);
  return new Response(null, { headers: { location: redirect.href }, status: 302 });
};

const authorizationServerMetadata = (state: ServerState): Response => {
  const { options, origin } = state;
  return json(200, {
    authorization_endpoint: `${origin}/authorize`,
    code_challenge_methods_supported: ["S256"],
    issuer: origin,
    registration_endpoint: `${origin}/register`,
    response_types_supported: ["code"],
    token_endpoint: `${origin}/token`,
    token_endpoint_auth_methods_supported: ["none"],
    ...(options.cimd === true ? { client_id_metadata_document_supported: true } : {}),
    ...(options.issParameter === true
      ? { authorization_response_iss_parameter_supported: true }
      : {}),
  });
};

const register = Effect.fn("register")(function* (state: ServerState, request: Request) {
  const metadata = (yield* readJson(request)) as Record<string, unknown>;
  state.log.push("register");
  state.registrations.push(metadata);
  return json(201, { ...metadata, client_id: "client-1" });
});

const route = Effect.fn("route")(function* (state: ServerState, request: Request) {
  const url = new URL(request.url);
  switch (url.pathname) {
    case "/mcp":
      return yield* handleMcp(state, request);
    case "/.well-known/oauth-protected-resource/mcp":
      return json(200, {
        authorization_servers: [state.origin],
        resource: `${state.origin}/mcp`,
      });
    case "/.well-known/oauth-authorization-server":
      return authorizationServerMetadata(state);
    case "/register":
      return yield* register(state, request);
    case "/authorize":
      return authorize(state, url);
    case "/token":
      return yield* handleToken(state, new URLSearchParams(yield* readText(request)));
    default:
      return new Response(null, { status: 404 });
  }
});

const handle = Effect.fn("handle")(function* (state: ServerState, request: Request) {
  const { pathname } = new URL(request.url);
  if (!state.stall.has(pathname)) {
    return yield* route(state, request);
  }
  state.stalled.push({ path: pathname, request });
  yield* Deferred.await(state.closing);
  return new Response(null, { status: 503 });
});

const initialState = (options: ServerOptions): ServerState => ({
  authorizations: [],
  challenges: new Map(),
  closing: Deferred.makeUnsafe<void>(),
  deletes: [],
  issued: 0,
  log: [],
  options,
  origin: "",
  refreshTokens: new Set(),
  registrations: [],
  stall: new Set(),
  stalled: [],
  tokenRequests: [],
  validTokens: new Set(),
});

const serve = Effect.fn("serve")(function* (state: ServerState) {
  const scope = yield* Scope.make();
  const serving = HttpServer.serve(
    HttpEffect.fromWebHandler((request) => runtime.runPromise(handle(state, request))),
  ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
  const services = yield* Layer.buildWithScope(serving, scope);
  const { address } = Context.get(services, HttpServer.HttpServer);
  if (!NetAddress.isInetAddress(address)) throw new Error("test server did not bind to TCP");
  state.origin = `http://127.0.0.1:${address.port}`;
  return scope;
});

const startOAuthMcpServer = (options: ServerOptions = {}) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const state = initialState(options);
      const scope = yield* serve(state);
      return {
        authorizations: state.authorizations,
        close: () =>
          runtime.runPromise(
            Effect.gen(function* () {
              Deferred.doneUnsafe(state.closing, Effect.void);
              yield* Scope.close(scope, Exit.void);
            }),
          ),
        deletes: state.deletes,
        expireAccessTokens: () => state.validTokens.clear(),
        log: state.log,
        registrations: state.registrations,
        stall: state.stall,
        stalled: state.stalled,
        tokenRequests: state.tokenRequests,
        url: `${state.origin}/mcp`,
      };
    }),
  );

const mcpOauthServer = {
  startOAuthMcpServer,
};

export default mcpOauthServer;
