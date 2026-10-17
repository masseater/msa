import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { LATEST_PROTOCOL_VERSION, McpError } from "../src/index.ts";
import { connect } from "./in-memory-server.ts";

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
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test-client", version: "2.0.0" },
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
            tools: [{ name: "search", description: "Search", inputSchema: { type: "object" } }],
            nextCursor: "page-2",
          }
        : {
            tools: [
              {
                name: "read",
                inputSchema: { type: "object" },
                outputSchema: { type: "object" },
                annotations: { readOnlyHint: true },
              },
            ],
            nextCursor: "",
          },
    ),
  );
  expect(yield* Effect.promise(() => client.listTools())).toEqual([
    { name: "search", description: "Search", inputSchema: { type: "object" } },
    {
      name: "read",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      annotations: { readOnlyHint: true },
    },
  ]);
  yield* Effect.promise(() => client.close());
});

const listsResources = Effect.gen(function* () {
  const { client, server } = yield* connect();
  server.setHandler("resources/list", (request) =>
    Effect.succeed(
      cursorOf(request.params) === undefined
        ? { resources: [{ uri: "file:///a", name: "a", mimeType: "text/plain" }], nextCursor: "2" }
        : { resources: [{ uri: "file:///b" }] },
    ),
  );
  server.setHandler("resources/templates/list", () =>
    Effect.succeed({
      resourceTemplates: [{ uriTemplate: "repo://{owner}/{repo}", name: "repo" }],
    }),
  );
  server.setHandler("resources/read", (request) =>
    Effect.succeed({
      contents: [{ uri: (request.params as { uri: string }).uri, text: "hello" }],
    }),
  );
  expect(yield* Effect.promise(() => client.listResources())).toEqual([
    { uri: "file:///a", name: "a", mimeType: "text/plain" },
    { uri: "file:///b", name: "file:///b" },
  ]);
  expect(yield* Effect.promise(() => client.listResourceTemplates())).toEqual([
    { uriTemplate: "repo://{owner}/{repo}", name: "repo" },
  ]);
  expect(yield* Effect.promise(() => client.listResourcesPage())).toEqual({
    resources: [{ uri: "file:///a", name: "a", mimeType: "text/plain" }],
    nextCursor: "2",
  });
  expect(yield* Effect.promise(() => client.listResourcesPage("2"))).toEqual({
    resources: [{ uri: "file:///b", name: "file:///b" }],
  });
  expect(yield* Effect.promise(() => client.readResource("file:///a"))).toEqual({
    contents: [{ uri: "file:///a", text: "hello" }],
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
      return Effect.fail(new McpError(1234, "tool failed", { retryable: false }));
    return Effect.succeed({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { count: params.arguments?.["count"] },
    });
  });
  expect(yield* Effect.promise(() => client.callTool("count", { count: 3 }))).toEqual({
    content: [{ type: "text", text: "ok" }],
    structuredContent: { count: 3 },
  });
  yield* Effect.promise(() =>
    expect(client.callTool("fail")).rejects.toMatchObject({
      name: "McpError",
      code: 1234,
      message: "tool failed",
      data: { retryable: false },
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
