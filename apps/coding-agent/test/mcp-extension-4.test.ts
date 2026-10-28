import mcp from "@msa/mcp";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import InMemoryAuthStorageBackend from "../src/core/in-memory-auth-storage-backend.ts";
import platform from "../src/core/platform/index.ts";
import runtime from "../src/extensions/mcp/runtime.ts";
import mcpConnectionSupport from "./mcp-connection-support.ts";

const { readEnv } = platform;
const { McpOAuthCredentialStore, McpServerConnection, createDefaultTransport } = runtime;
const { McpHttpError } = mcp;

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  realPath,
  removePath,
  runTest,
  sleep,
  tempRoot,
  writeTextFile,
} = testing;

const { HTTP_ENTRY, STDIO_ENTRY, connect, createTransport, failingTransport, fakeServers } =
  mcpConnectionSupport;

const startsANewSessionAndRetriesOnce = () =>
  runTest(
    Effect.gen(function* () {
      const { connection, opened } = connect(STDIO_ENTRY, [
        () => createTransport({ expireFirstCall: true }),
        () => createTransport(),
      ]);
      const results = yield* awaited(
        Promise.all([connection.callTool("echo", {}, {}), connection.callTool("echo", {}, {})]),
      );
      expect(results).toEqual([
        { content: [{ text: "ok", type: "text" }] },
        { content: [{ text: "ok", type: "text" }] },
      ]);
      expect(opened()).toBe(2);
      yield* awaited(connection.close());
    }),
  );

const expandsInTheCommandArgumentsAndCwd = () =>
  runTest(
    Effect.gen(function* () {
      const home = yield* makeTempDir("msa-mcp-home-");
      const previousHome = readEnv("HOME");
      vi.stubEnv("HOME", home);
      yield* makeDirectory(joinPath(home, "work"));

      yield* writeTextFile(
        joinPath(home, "server.mjs"),
        `import { createInterface } from "node:readline";
for await (const line of createInterface({ input: process.stdin })) {
	const message = JSON.parse(line);
	if (!("id" in message)) continue;
	const result = message.method === "initialize"
		? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "cwd", version: "1" } }
		: message.method === "tools/list"
			? { tools: [{ name: "cwd", inputSchema: { type: "object" } }] }
			: { content: [{ type: "text", text: process.cwd() }] };
	process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
}`,
      );
      const connection = new McpServerConnection({
        createTransport: createDefaultTransport,
        credentials: new McpOAuthCredentialStore(new InMemoryAuthStorageBackend()),
        cwd: tempRoot(),
        entry: {
          config: { args: ["~/server.mjs"], command: process.execPath, cwd: "~/work" },
          name: "home",
          source: "test",
        },
        onTools: () => {},
      });
      try {
        const result = yield* awaited(connection.callTool("cwd", {}, {}));
        expect(yield* realPath((result.content[0] as { text: string }).text)).toBe(
          yield* realPath(joinPath(home, "work")),
        );
      } finally {
        yield* awaited(connection.close());
        vi.stubEnv("HOME", previousHome);
        yield* removePath(home);
      }
    }),
  );

const connectsToServersWithoutTheToolsCapability = () =>
  runTest(
    Effect.gen(function* () {
      const methods: string[] = [];
      const { connection } = connect(STDIO_ENTRY, [
        () => createTransport({ methods, noTools: true }),
      ]);
      yield* awaited(connection.getClient());
      expect(connection.state).toBe("connected");
      expect(connection.tools).toEqual([]);
      expect(methods).toEqual(["initialize"]);
      yield* awaited(connection.close());
    }),
  );

const marksADroppedConnectionAndReconnectsOn = () =>
  runTest(
    Effect.gen(function* () {
      const { connection, opened } = connect(STDIO_ENTRY, [
        () => createTransport(),
        () => createTransport(),
      ]);
      yield* awaited(connection.getClient());
      yield* awaited(fakeServers.at(-1)?.close());
      yield* sleep("0 millis");
      expect(connection.state).toBe("disconnected");
      expect(connection.error).toBe("Connection closed");
      expect(yield* awaited(connection.callTool("echo", {}, {}))).toEqual({
        content: [{ text: "ok", type: "text" }],
      });
      expect(connection.state).toBe("connected");
      expect(opened()).toBe(2);
      yield* awaited(connection.close());
    }),
  );

describe("MCP connections", () => {
  it(
    "starts a new session and retries once when the session expired",
    startsANewSessionAndRetriesOnce,
  );

  it.skipIf(process.platform === "win32")(
    "expands ~ in the command, arguments, and cwd of stdio servers",
    expandsInTheCommandArgumentsAndCwd,
  );

  it(
    "connects to servers without the tools capability without listing tools",
    connectsToServersWithoutTheToolsCapability,
  );

  it(
    "marks a dropped connection and reconnects on the next call",
    marksADroppedConnectionAndReconnectsOn,
  );

  it("retries HTTP connections that fail with a transient error", () =>
    runTest(
      Effect.gen(function* () {
        const { connection, opened } = connect(HTTP_ENTRY, [
          failingTransport(McpHttpError.create(503, "MCP HTTP request failed with status 503")),
          () => createTransport(),
        ]);
        yield* awaited(connection.getClient());
        expect(connection.state).toBe("connected");
        expect(opened()).toBe(2);
        yield* awaited(connection.close());

        const failing = connect(HTTP_ENTRY, [
          failingTransport(
            McpHttpError.create(400, "MCP HTTP request failed with status 400: bad"),
          ),
        ]);
        yield* awaited(expect(failing.connection.getClient()).rejects.toThrow("status 400: bad"));
        expect(failing.connection.state).toBe("failed");
        expect(failing.opened()).toBe(1);
      }),
    ));
});
