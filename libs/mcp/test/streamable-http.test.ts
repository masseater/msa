import testing from "@msa/testing";
import { Deferred, Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import mcp from "../src/index.ts";
import type mcpTypes from "../src/index.types.ts";
import httpFixture from "./http-fixture.ts";

const { LATEST_PROTOCOL_VERSION, McpClient, McpSessionExpiredError, StreamableHttpTransport } = mcp;

const { closeServers, encodeJson, openStream, readBody, readMessage } = testing;
const { protocolHandler, protocolHandlerFor, startServer, toolsCallOnly } = httpFixture;

const eventStream = (body: string | ReadableStream<Uint8Array>) =>
  new Response(body, { headers: { "content-type": "text/event-stream" }, status: 200 });

const newClient = () => new McpClient({ name: "http-test", version: "1.0.0" });

const connectTo = (client: mcpTypes.McpClient, transport: mcpTypes.StreamableHttpTransport) =>
  Effect.promise(() => client.connect(transport));

const handlesJsonAndSse = Effect.gen(function* () {
  const { url, requests } = yield* startServer(protocolHandler);
  const transport = new StreamableHttpTransport({ url });
  const client = newClient();
  yield* connectTo(client, transport);
  expect(transport.sessionId).toBe("session-1");
  expect(yield* Effect.promise(() => client.listTools())).toEqual([
    { inputSchema: { type: "object" }, name: "echo" },
  ]);
  expect(yield* Effect.promise(() => client.callTool("echo", { text: "hello" }))).toEqual({
    content: [{ text: "hello", type: "text" }],
  });
  yield* Effect.promise(() => client.close());
  const listRequest = requests.find((entry) => entry.message?.["method"] === "tools/list");
  expect(listRequest?.headers["mcp-session-id"]).toBe("session-1");
  expect(listRequest?.headers["mcp-protocol-version"]).toBe(LATEST_PROTOCOL_VERSION);
  expect(requests.some((entry) => entry.method === "GET")).toBe(true);
  expect(requests.some((entry) => entry.method === "DELETE")).toBe(true);
});

const classifiesAuthFailures = Effect.gen(function* () {
  const { url } = yield* startServer((request) =>
    readBody(request).pipe(
      Effect.as(
        new Response("login required", {
          headers: { "www-authenticate": 'Bearer resource_metadata="https://example.com/meta"' },
          status: 401,
        }),
      ),
    ),
  );
  const client = newClient();
  yield* Effect.promise(() =>
    expect(client.connect(new StreamableHttpTransport({ url }))).rejects.toMatchObject({
      body: "login required",
      name: "McpAuthRequiredError",
      status: 401,
      wwwAuthenticate: 'Bearer resource_metadata="https://example.com/meta"',
    } satisfies Partial<mcpTypes.McpAuthRequiredError>),
  );
});

const failsOnlyBrokenStream = Effect.gen(function* () {
  const slowGate = Deferred.makeUnsafe<void>();
  const { url } = yield* startServer((request, requests) =>
    Effect.gen(function* () {
      if (request.method !== "POST") return yield* protocolHandler(request, requests);
      const message = yield* readMessage(request);
      const name = (message["params"] as { name?: string } | undefined)?.name;
      if (name === "broken") return eventStream("data: not json\n\n");
      if (name === "slow") yield* Deferred.await(slowGate);
      return yield* protocolHandlerFor(message)(request, requests);
    }),
  );
  const client = newClient();
  const errors: Error[] = [];
  client.onError((error) => errors.push(error));
  yield* connectTo(client, new StreamableHttpTransport({ openGetStream: false, url }));
  const slow = client.callTool("slow");
  yield* Effect.promise(() =>
    expect(client.callTool("broken")).rejects.toThrow("MCP response stream failed"),
  );
  Deferred.doneUnsafe(slowGate, Effect.void);
  expect(yield* Effect.promise(() => slow)).toEqual({ content: [{ text: "hello", type: "text" }] });
  expect(errors).toHaveLength(1);
  yield* Effect.promise(() => client.close());
});

const opensGetStreamAfterInit = Effect.gen(function* () {
  const order: string[] = [];
  const { url, requests } = yield* startServer((request, recorded) =>
    Effect.gen(function* () {
      if (request.method !== "POST") {
        order.push(request.method);
        return yield* protocolHandler(request, recorded);
      }
      const message = yield* readMessage(request);
      order.push(String(message["method"]));
      return yield* protocolHandlerFor(message)(request, recorded);
    }),
  );
  const client = newClient();
  yield* connectTo(client, new StreamableHttpTransport({ url }));
  yield* Effect.promise(() => client.callTool("echo"));
  yield* Effect.promise(() => client.listTools());
  yield* Effect.promise(() => client.close());
  expect(order.indexOf("GET")).toBeGreaterThan(order.indexOf("notifications/initialized"));
  expect(requests.every((entry) => entry.headers["last-event-id"] === undefined)).toBe(true);
});

const resumesClosedStream = Effect.gen(function* () {
  const resumeHeaders: (string | undefined)[] = [];
  const resumed = yield* encodeJson({
    id: 2,
    jsonrpc: "2.0",
    result: { content: [{ text: "resumed", type: "text" }] },
  });
  const respondToCall = toolsCallOnly(() => eventStream("id: 1\nretry: 5\ndata:\n\n"));
  const { url } = yield* startServer((request, requests) => {
    const lastEventId = request.headers.get("last-event-id");
    if (request.method !== "GET" || lastEventId === null || lastEventId === "")
      return respondToCall(request, requests);
    return Effect.sync(() => {
      resumeHeaders.push(lastEventId);
      return eventStream(`id: 2\ndata: ${resumed}\n\n`);
    });
  });
  const client = newClient();
  const errors: Error[] = [];
  client.onError((error) => errors.push(error));
  yield* connectTo(client, new StreamableHttpTransport({ openGetStream: false, url }));
  expect(yield* Effect.promise(() => client.callTool("echo"))).toEqual({
    content: [{ text: "resumed", type: "text" }],
  });
  expect(resumeHeaders).toEqual(["1"]);
  expect(errors).toEqual([]);
  yield* Effect.promise(() => client.close());
});

const failsUnansweredStream = Effect.gen(function* () {
  const { url } = yield* startServer(toolsCallOnly(() => eventStream(": nothing here\n\n")));
  const client = newClient();
  yield* connectTo(client, new StreamableHttpTransport({ openGetStream: false, url }));
  yield* Effect.promise(() =>
    expect(client.callTool("echo", {}, { timeoutMs: 5_000 })).rejects.toThrow(
      "MCP response stream failed: stream ended without a response",
    ),
  );
  yield* Effect.promise(() => client.close());
});

const reconnectsGetStream = Effect.gen(function* () {
  let gets = 0;
  const lastEventIds: (string | undefined)[] = [];
  const notification = yield* encodeJson({
    jsonrpc: "2.0",
    method: "notifications/tools/list_changed",
  });
  const { url } = yield* startServer((request, requests) => {
    if (request.method !== "GET") return protocolHandler(request, requests);
    return Effect.sync(() => {
      gets++;
      lastEventIds.push(request.headers.get("last-event-id") ?? undefined);
      return gets === 1
        ? eventStream(`id: g1\ndata: ${notification}\n\n`)
        : eventStream(openStream(`id: g2\ndata: ${notification}\n\n`));
    });
  });
  const client = newClient();
  let changes = 0;
  const secondChange = Deferred.makeUnsafe<void>();
  client.onNotification("notifications/tools/list_changed", () => {
    if (++changes === 2) Deferred.doneUnsafe(secondChange, Effect.void);
  });
  yield* connectTo(client, new StreamableHttpTransport({ reconnect: { initialDelayMs: 1 }, url }));
  yield* Deferred.await(secondChange);
  expect(lastEventIds).toEqual([undefined, "g1"]);
  yield* Effect.promise(() => client.close());
});

const rejectsAcceptedWithoutResponse = Effect.gen(function* () {
  const { url } = yield* startServer(toolsCallOnly(() => new Response(null, { status: 202 })));
  const client = newClient();
  yield* connectTo(client, new StreamableHttpTransport({ openGetStream: false, url }));
  yield* Effect.promise(() =>
    expect(client.callTool("echo")).rejects.toThrow("without a response"),
  );
  yield* Effect.promise(() => client.close());
});

const includesBodyInErrors = Effect.gen(function* () {
  const { url } = yield* startServer((request) =>
    readBody(request).pipe(Effect.as(new Response("Invalid Accept header", { status: 400 }))),
  );
  yield* Effect.promise(() =>
    expect(newClient().connect(new StreamableHttpTransport({ url }))).rejects.toThrow(
      "MCP HTTP request failed with status 400: Invalid Accept header",
    ),
  );
});

const classifiesExpiredSession = Effect.gen(function* () {
  let posts = 0;
  const { url } = yield* startServer((request, requests) => {
    if (request.method !== "POST" || posts++ < 2) return protocolHandler(request, requests);
    return readBody(request).pipe(Effect.as(new Response("gone", { status: 404 })));
  });
  const client = newClient();
  yield* connectTo(client, new StreamableHttpTransport({ openGetStream: false, url }));
  yield* Effect.promise(() =>
    expect(client.listTools()).rejects.toBeInstanceOf(McpSessionExpiredError),
  );
  yield* Effect.promise(() => client.close());
});

afterEach(() => Effect.runPromise(closeServers));

describe("StreamableHttpTransport", () => {
  it("handles JSON and SSE responses with session and protocol headers", () =>
    Effect.runPromise(handlesJsonAndSse));
  it("classifies authentication failures", () => Effect.runPromise(classifiesAuthFailures));
  it("fails only the request whose SSE stream breaks", () =>
    Effect.runPromise(failsOnlyBrokenStream));
  it("opens the GET stream after initialization and sends Last-Event-ID only when resuming", () =>
    Effect.runPromise(opensGetStreamAfterInit));
  it("resumes a response stream the server closed before answering", () =>
    Effect.runPromise(resumesClosedStream));
  it("fails a request whose response stream ends without an answer", () =>
    Effect.runPromise(failsUnansweredStream));
  it("reconnects the GET stream after it drops", () => Effect.runPromise(reconnectsGetStream));
  it("rejects a request the server accepts without a response", () =>
    Effect.runPromise(rejectsAcceptedWithoutResponse));
  it("includes the response body in HTTP errors", () => Effect.runPromise(includesBodyInErrors));
  it("classifies an expired established session", () =>
    Effect.runPromise(classifiesExpiredSession));
});
