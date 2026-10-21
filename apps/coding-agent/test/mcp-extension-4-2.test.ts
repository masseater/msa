import mcp from "@msa/mcp";
import testingModule from "@msa/mcp/testing";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import InMemoryAuthStorageBackend from "../src/core/in-memory-auth-storage-backend.ts";
import runtime from "../src/extensions/mcp/runtime.ts";
import mcpConnectionSupport from "./mcp-connection-support.ts";

const { McpOAuthCredentialStore, McpServerConnection, McpServerLog, createDefaultTransport } =
  runtime;
const { createInMemoryTransportPair } = testingModule;
const { McpAuthRequiredError, McpHttpError } = mcp;

const {
  awaited,
  closeServers,
  joinPath,
  listen,
  makeTempDir,
  readTextFile,
  removePath,
  runTest,
  sleep,
} = testing;

const { HTTP_ENTRY, STDIO_ENTRY, connect, createTransport, failingTransport, fakeServers } =
  mcpConnectionSupport;

const closesAConnectionThatIsStillInitializing = () =>
  runTest(
    Effect.gen(function* () {
      const pair = createInMemoryTransportPair();

      const initializing = Effect.callback<void>((resume) => {
        pair.server.onMessage(() => resume(Effect.void));
      });
      void pair.server.start();
      let transportClosed = false;
      pair.client.onClose(() => {
        transportClosed = true;
      });
      const { connection } = connect(STDIO_ENTRY, [() => pair.client]);
      let failure: unknown;
      void connection.getClient().catch((error) => {
        failure = error;
      });
      yield* initializing;
      yield* awaited(connection.close());
      expect(transportClosed).toBe(true);
      expect(String(failure)).toContain("failed to connect");
    }),
  );

const stopsWaitingToRetryAConnectionWhen = () =>
  runTest(
    Effect.gen(function* () {
      const { connection } = connect(HTTP_ENTRY, [
        failingTransport(new McpHttpError(503, "MCP HTTP request failed with status 503")),
      ]);
      let failure: unknown;
      void connection.getClient().catch((error) => {
        failure = error;
      });

      yield* sleep("10 millis");
      yield* awaited(connection.close());
      expect(String(failure)).toContain("status 503");
    }),
  );

const retriesResourceReadsButNotToolCalls = () =>
  runTest(
    Effect.gen(function* () {
      const transport = createTransport();
      const send = transport.send.bind(transport);
      const failed = new Set<string>();

      transport.send = (message) => {
        const method = "method" in message ? message.method : "";
        if ((method === "resources/read" || method === "tools/call") && !failed.has(method)) {
          failed.add(method);
          return Promise.reject(new McpHttpError(502, "MCP HTTP request failed with status 502"));
        }
        return send(message);
      };
      const { connection } = connect(STDIO_ENTRY, [() => transport]);
      expect(yield* awaited(connection.readResource("docs://a", {}))).toEqual({
        contents: [{ text: "ok", uri: "docs://a" }],
      });
      yield* awaited(expect(connection.callTool("echo", {}, {})).rejects.toThrow("status 502"));
      yield* awaited(connection.close());
    }),
  );

const asksOauthServersThatKeepRejectingRequests = () =>
  runTest(
    Effect.gen(function* () {
      const { connection } = connect(
        { config: { url: "http://unused.invalid" }, name: "fake", source: "test" },
        [failingTransport(new McpAuthRequiredError(new Response(null, { status: 401 })))],
      );
      yield* awaited(
        expect(connection.getClient()).rejects.toThrow(
          'MCP server "fake" requires sign-in. Run /mcp to sign in.',
        ),
      );
      expect(connection.state).toBe("needs-auth");
      yield* awaited(connection.close());
    }),
  );

const sendsTheProviderTokenAndAsksFor = () =>
  runTest(
    Effect.gen(function* () {
      const authorizations: (string | null)[] = [];
      const origin = yield* listen((request) =>
        Effect.sync(() => {
          authorizations.push(request.headers.get("authorization"));
          return new Response(null, { status: 401 });
        }),
      );
      const connection = new McpServerConnection({
        createTransport: createDefaultTransport,
        credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),
        cwd: process.cwd(),
        entry: {
          config: { auth: { provider: "openrouter" }, url: `${origin}/mcp` },
          name: "openrouter",
          source: "test",
        },
        onTools: () => {},
        providerToken: (provider) => Promise.resolve(provider === "openrouter" ? "tok" : undefined),
      });
      try {
        expect(connection.auth.oauthUrl).toBeUndefined();
        yield* awaited(
          expect(connection.getClient()).rejects.toThrow(
            'MCP server "openrouter" requires sign-in. Run /login openrouter to sign in.',
          ),
        );
        expect(connection.state).toBe("needs-auth");
        expect(authorizations).toEqual(["Bearer tok"]);
      } finally {
        yield* awaited(connection.close());
        yield* closeServers;
      }
    }),
  );

const appendsServerLogMessagesToTheLog = () =>
  runTest(
    Effect.gen(function* () {
      const dir = yield* makeTempDir("msa-mcp-log-");
      try {
        const path = joinPath(dir, "mcp.log");
        const log = new McpServerLog(path);
        const { connection } = connect(STDIO_ENTRY, [() => createTransport()], log);
        yield* awaited(connection.getClient());
        const server = fakeServers.at(-1);
        yield* awaited(
          server?.send({
            jsonrpc: "2.0",
            method: "notifications/message",
            params: { data: "slow\nquery", level: "warning", logger: "db" },
          }),
        );
        yield* awaited(
          server?.send({
            jsonrpc: "2.0",
            method: "notifications/message",
            params: { data: { code: 7 }, level: "error" },
          }),
        );
        yield* sleep("0 millis");
        yield* awaited(log.flush());
        const lines = (yield* readTextFile(path)).replace(/^\S+ /gmu, "");
        expect(lines).toBe('[fake] warning db: slow\n    query\n[fake] error {"code":7}\n');
        yield* awaited(connection.close());
      } finally {
        yield* removePath(dir);
      }
    }),
  );

const resolvesTheOauthClientSecretLazily = () =>
  runTest(
    Effect.gen(function* () {
      const { connection } = connect(
        {
          config: { oauth: { clientSecret: "!exit 1" }, url: "http://unused.invalid" },
          name: "fake",
          source: "test",
        },
        [() => createTransport()],
      );
      expect(yield* awaited(connection.callTool("echo", {}, {}))).toEqual({
        content: [{ text: "ok", type: "text" }],
      });
      expect(() => connection.auth.oauthSettings()).toThrow("oauth.clientSecret");
      yield* awaited(connection.close());
    }),
  );

const connectsToServersWithResourcesWithoutListing = () =>
  runTest(
    Effect.gen(function* () {
      const methods: string[] = [];
      const { connection } = connect(STDIO_ENTRY, [
        () => createTransport({ methods, resources: true }),
      ]);
      yield* awaited(connection.getClient());
      expect(connection.state).toBe("connected");
      expect(connection.hasResources).toBe(true);
      expect(methods).toEqual(["initialize", "tools/list"]);
      yield* awaited(connection.close());
    }),
  );

describe("MCP connections", () => {
  it(
    "closes a connection that is still initializing before close returns",
    closesAConnectionThatIsStillInitializing,
  );

  it("stops waiting to retry a connection when closed", stopsWaitingToRetryAConnectionWhen);

  it(
    "retries resource reads, but not tool calls, after a transient HTTP error",
    retriesResourceReadsButNotToolCalls,
  );

  it(
    "asks OAuth servers that keep rejecting requests for a new sign-in",
    asksOauthServersThatKeepRejectingRequests,
  );

  it(
    "sends the provider token and asks for the provider login when the server rejects it",
    sendsTheProviderTokenAndAsksFor,
  );

  it("appends server log messages to the log file", appendsServerLogMessagesToTheLog);

  it("resolves the OAuth client secret lazily", resolvesTheOauthClientSecretLazily);

  it(
    "connects to servers with resources without listing them",
    connectsToServersWithResourcesWithoutListing,
  );
});
