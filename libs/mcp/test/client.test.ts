import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import mcp from "../src/index.ts";
import inMemoryServer from "./in-memory-server.ts";

const { LATEST_PROTOCOL_VERSION, McpError } = mcp;

const { connect } = inMemoryServer;

const cursorOf = (params: unknown): string | undefined =>
  (params as { cursor?: string } | undefined)?.cursor;

const initializes = Effect.gen(function* () {
  const { client, server } = yield* connect();
  expect(client.connectionState).toBe("connected");
  expect(client.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  expect(client.serverInfo).toEqual({ name: "test-server", version: "1.0.0" });
  expect(client.serverCapabilities).toEqual({ tools: { listChanged: true } });
  expect(client.instructions).toBe("Use test tools.");
  expect(server.messages).toEqual([
    {
      id: 1,
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        capabilities: {},
        clientInfo: { name: "test-client", version: "2.0.0" },
        protocolVersion: LATEST_PROTOCOL_VERSION,
      },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
  ]);
  yield* Effect.promise(() => client.close());
});

const paginatesTools = Effect.gen(function* () {
  const { client, server } = yield* connect();
  server.setHandler("tools/list", (request) =>
    Effect.succeed(
      cursorOf(request.params) === undefined
        ? {
            nextCursor: "page-2",
            tools: [{ description: "Search", inputSchema: { type: "object" }, name: "search" }],
          }
        : {
            nextCursor: "",
            tools: [
              {
                annotations: { readOnlyHint: true },
                inputSchema: { type: "object" },
                name: "read",
                outputSchema: { type: "object" },
              },
            ],
          },
    ),
  );
  expect(yield* Effect.promise(() => client.listTools())).toEqual([
    { description: "Search", inputSchema: { type: "object" }, name: "search" },
    {
      annotations: { readOnlyHint: true },
      inputSchema: { type: "object" },
      name: "read",
      outputSchema: { type: "object" },
    },
  ]);
  yield* Effect.promise(() => client.close());
});

const listsResources = Effect.gen(function* () {
  const { client, server } = yield* connect();
  server.setHandler("resources/list", (request) =>
    Effect.succeed(
      cursorOf(request.params) === undefined
        ? { nextCursor: "2", resources: [{ mimeType: "text/plain", name: "a", uri: "file:///a" }] }
        : { resources: [{ uri: "file:///b" }] },
    ),
  );
  server.setHandler("resources/templates/list", () =>
    Effect.succeed({
      resourceTemplates: [{ name: "repo", uriTemplate: "repo://{owner}/{repo}" }],
    }),
  );
  server.setHandler("resources/read", (request) =>
    Effect.succeed({
      contents: [{ text: "hello", uri: (request.params as { uri: string }).uri }],
    }),
  );
  expect(yield* Effect.promise(() => client.listResources())).toEqual([
    { mimeType: "text/plain", name: "a", uri: "file:///a" },
    { name: "file:///b", uri: "file:///b" },
  ]);
  expect(yield* Effect.promise(() => client.listResourceTemplates())).toEqual([
    { name: "repo", uriTemplate: "repo://{owner}/{repo}" },
  ]);
  expect(yield* Effect.promise(() => client.listResourcesPage())).toEqual({
    nextCursor: "2",
    resources: [{ mimeType: "text/plain", name: "a", uri: "file:///a" }],
  });
  expect(yield* Effect.promise(() => client.listResourcesPage("2"))).toEqual({
    resources: [{ name: "file:///b", uri: "file:///b" }],
  });
  expect(yield* Effect.promise(() => client.readResource("file:///a"))).toEqual({
    contents: [{ text: "hello", uri: "file:///a" }],
  });
  yield* rejectsInvalidResources(client, server);
});

const rejectsInvalidResources = (
  client: Effect.Success<ReturnType<typeof connect>>["client"],
  server: Effect.Success<ReturnType<typeof connect>>["server"],
) =>
  Effect.gen(function* () {
    server.setHandler("resources/read", () => Effect.succeed({ contents: [{ uri: "file:///a" }] }));
    yield* Effect.promise(() =>
      expect(client.readResource("file:///a")).rejects.toThrow(
        "Invalid contents in MCP resources/read result",
      ),
    );
    server.setHandler("resources/list", () => Effect.succeed({ resources: [{ name: "no uri" }] }));
    yield* Effect.promise(() =>
      expect(client.listResources()).rejects.toThrow("Invalid entry in MCP resources/list result"),
    );
    yield* Effect.promise(() => client.close());
  });

const callsTools = Effect.gen(function* () {
  const { client, server } = yield* connect();
  server.setHandler("tools/call", (request) => {
    const params = request.params as { name: string; arguments?: Record<string, unknown> };
    if (params.name === "fail")
      return Effect.fail(McpError.create(1234, "tool failed", { retryable: false }));
    return Effect.succeed({
      content: [{ text: "ok", type: "text" }],
      structuredContent: { count: params.arguments?.["count"] },
    });
  });
  expect(yield* Effect.promise(() => client.callTool("count", { count: 3 }))).toEqual({
    content: [{ text: "ok", type: "text" }],
    structuredContent: { count: 3 },
  });
  yield* Effect.promise(() =>
    expect(client.callTool("fail")).rejects.toMatchObject({
      code: 1234,
      data: { retryable: false },
      message: "tool failed",
      name: "McpError",
    }),
  );
  yield* Effect.promise(() => client.close());
});

const defaultsMissingContent = Effect.gen(function* () {
  const { client, server } = yield* connect();
  server.setHandler("tools/call", () => Effect.succeed({ structuredContent: { ok: true } }));
  expect(yield* Effect.promise(() => client.callTool("structured"))).toEqual({
    content: [],
    structuredContent: { ok: true },
  });
  server.setHandler("tools/call", () => Effect.succeed({ content: "not a list" }));
  yield* Effect.promise(() =>
    expect(client.callTool("broken")).rejects.toThrow("Invalid MCP tools/call result"),
  );
  yield* Effect.promise(() => client.close());
});

const acceptsNonObjectStructuredContent = Effect.gen(function* () {
  const { client, server } = yield* connect();
  for (const structuredContent of [[{ id: 1 }, { id: 2 }], null, "text", 3, false]) {
    server.setHandler("tools/call", () => Effect.succeed({ content: [], structuredContent }));
    expect(yield* Effect.promise(() => client.callTool("structured"))).toEqual({
      content: [],
      structuredContent,
    });
  }
  yield* Effect.promise(() => client.close());
});

describe("McpClient", () => {
  it("initializes the connection before exposing server information", () =>
    Effect.runPromise(initializes));
  it("paginates tools and preserves protocol tool definitions", () =>
    Effect.runPromise(paginatesTools));
  it("lists and reads resources", () => Effect.runPromise(listsResources));
  it("returns structured tool content and surfaces JSON-RPC errors", () =>
    Effect.runPromise(callsTools));
  it("defaults missing tool result content to an empty list", () =>
    Effect.runPromise(defaultsMissingContent));
  it("accepts structured content that is not an object", () =>
    Effect.runPromise(acceptsNonObjectStructuredContent));
});
