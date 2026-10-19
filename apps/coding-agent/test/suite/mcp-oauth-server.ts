import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { LATEST_PROTOCOL_VERSION } from "@msa/mcp";
import { fromJsonText } from "@msa/testing";
import { Context, Crypto, Deferred, Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { HttpEffect, HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";

const runtime = ManagedRuntime.make(NodeServices.layer);

interface StalledRequest {
  path: string;
  request: Request;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const readText = (request: Request): Effect.Effect<string> => Effect.promise(() => request.text());

const readJson = (request: Request): Effect.Effect<unknown> =>
  Effect.flatMap(readText(request), fromJsonText);

const sha256Base64Url = (value: string) =>
  Effect.map(
    Crypto.Crypto.use((crypto) => crypto.digest("SHA-256", new TextEncoder().encode(value))),
    (digest) => Buffer.from(digest).toString("base64url"),
  );

export function startOAuthMcpServer(
  options: { iss?: string; issParameter?: boolean; cimd?: boolean; redirectPath?: string } = {},
) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const log: string[] = [];
      const registrations: Record<string, unknown>[] = [];
      const authorizations: URLSearchParams[] = [];
      const tokenRequests: URLSearchParams[] = [];
      const deletes: (string | undefined)[] = [];
      const stall = new Set<string>();
      const stalled: StalledRequest[] = [];
      const validTokens = new Set<string>();
      const refreshTokens = new Set<string>();
      const challenges = new Map<string, string>();
      const closing = Deferred.makeUnsafe<void>();
      let issued = 0;
      let origin = "";

      const issueTokens = () => {
        issued++;
        const tokens = { access_token: `access-${issued}`, refresh_token: `refresh-${issued}` };
        validTokens.add(tokens.access_token);
        refreshTokens.add(tokens.refresh_token);
        return { ...tokens, token_type: "Bearer", expires_in: 3600 };
      };

      const handleMcp = (request: Request) =>
        Effect.gen(function* () {
          const token = request.headers.get("authorization")?.replace(/^Bearer /u, "");
          if (request.method === "DELETE") deletes.push(token);
          if (request.method !== "POST") {
            return new Response(null, { status: request.method === "GET" ? 405 : 200 });
          }
          if (token === undefined || token === "" || !validTokens.has(token)) {
            log.push(`401 ${token ?? "none"}`);
            return new Response(null, {
              status: 401,
              headers: {
                "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
              },
            });
          }
          const message = (yield* readJson(request)) as {
            id?: number;
            method: string;
            params?: unknown;
          };
          if (message.id === undefined) return new Response(null, { status: 202 });
          let result: unknown;
          if (message.method === "initialize") {
            result = {
              protocolVersion: LATEST_PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: "issues", version: "1.0.0" },
            };
          } else if (message.method === "tools/list") {
            result = {
              tools: [{ name: "whoami", inputSchema: { type: "object", properties: {} } }],
            };
          } else if (message.method === "tools/call") {
            log.push(`call ${token}`);
            result = { content: [{ type: "text", text: `token ${token}` }] };
          } else {
            result = {};
          }
          return json(
            200,
            { jsonrpc: "2.0", id: message.id, result },
            { "mcp-session-id": "session-1" },
          );
        });

      const handleToken = (params: URLSearchParams) =>
        Effect.gen(function* () {
          tokenRequests.push(params);
          if (params.get("grant_type") === "authorization_code") {
            const challenge = challenges.get(params.get("code") ?? "");
            const verifier = yield* sha256Base64Url(params.get("code_verifier") ?? "");
            if (challenge === undefined || challenge === "" || challenge !== verifier)
              return json(400, { error: "invalid_grant" });
            challenges.delete(params.get("code") ?? "");
            log.push("token code");
            return json(200, issueTokens());
          }
          const refresh = params.get("refresh_token") ?? "";
          if (!refreshTokens.delete(refresh)) return json(400, { error: "invalid_grant" });
          log.push("token refresh");
          return json(200, issueTokens());
        });

      const authorize = (url: URL) => {
        authorizations.push(url.searchParams);
        const code = `code-${challenges.size + 1}`;
        challenges.set(code, url.searchParams.get("code_challenge") ?? "");
        const redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
        if (options.redirectPath !== undefined && options.redirectPath !== "")
          redirect.pathname = options.redirectPath;
        redirect.searchParams.set("code", code);
        redirect.searchParams.set("state", url.searchParams.get("state") ?? "");
        const iss = options.iss ?? (options.issParameter === true ? origin : undefined);
        if (iss !== undefined && iss !== "") redirect.searchParams.set("iss", iss);
        return new Response(null, { status: 302, headers: { location: redirect.href } });
      };

      const handle = (request: Request) =>
        Effect.gen(function* () {
          const url = new URL(request.url);
          if (stall.has(url.pathname)) {
            stalled.push({ path: url.pathname, request });
            yield* Deferred.await(closing);
            return new Response(null, { status: 503 });
          }
          switch (url.pathname) {
            case "/mcp":
              return yield* handleMcp(request);
            case "/.well-known/oauth-protected-resource/mcp":
              return json(200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
            case "/.well-known/oauth-authorization-server":
              return json(200, {
                issuer: origin,
                authorization_endpoint: `${origin}/authorize`,
                token_endpoint: `${origin}/token`,
                registration_endpoint: `${origin}/register`,
                response_types_supported: ["code"],
                code_challenge_methods_supported: ["S256"],
                token_endpoint_auth_methods_supported: ["none"],
                ...(options.cimd === true ? { client_id_metadata_document_supported: true } : {}),
                ...(options.issParameter === true
                  ? { authorization_response_iss_parameter_supported: true }
                  : {}),
              });
            case "/register": {
              const metadata = (yield* readJson(request)) as Record<string, unknown>;
              log.push("register");
              registrations.push(metadata);
              return json(201, { ...metadata, client_id: "client-1" });
            }
            case "/authorize":
              return authorize(url);
            case "/token":
              return yield* handleToken(new URLSearchParams(yield* readText(request)));
            default:
              return new Response(null, { status: 404 });
          }
        });

      const scope = yield* Scope.make();
      const serving = HttpServer.serve(
        HttpEffect.fromWebHandler((request) => runtime.runPromise(handle(request))),
      ).pipe(Layer.provideMerge(NodeHttpServer.layerTest));
      const services = yield* Layer.buildWithScope(serving, scope);
      const { address } = Context.get(services, HttpServer.HttpServer);
      if (!NetAddress.isInetAddress(address)) throw new Error("test server did not bind to TCP");
      origin = `http://127.0.0.1:${address.port}`;
      return {
        url: `${origin}/mcp`,
        log,
        registrations,
        authorizations,
        tokenRequests,
        deletes,
        stall,
        stalled,
        expireAccessTokens: () => validTokens.clear(),
        close: () =>
          runtime.runPromise(
            Effect.gen(function* () {
              Deferred.doneUnsafe(closing, Effect.void);
              yield* Scope.close(scope, Exit.void);
            }),
          ),
      };
    }),
  );
}
