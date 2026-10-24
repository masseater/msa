import { Deferred, Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import mcp from "../src/index.ts";
import inMemoryServer from "./in-memory-server.ts";
import type inMemoryServerTypes from "./in-memory-server.types.ts";

const { McpAbortError, McpClient, McpTimeoutError } = mcp;

const { connect, createServer } = inMemoryServer;

const yieldMacrotask = Effect.yieldNow;

const progressTokenOf = (params: unknown): number =>
  (params as Record<string, { progressToken: number }>)["_meta"]?.progressToken ?? 0;

const abortController = (): AbortController => new AbortController();

const sendProgress = (server: inMemoryServerTypes.TestServer, token: number) =>
  Effect.promise(() =>
    server.transport.send({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: { progress: 1, progressToken: token, total: 2 },
    }),
  );

const renewsTimeout = Effect.gen(function* () {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setImmediate", "clearImmediate"] });
  const { client, server } = yield* connect();
  server.setHandler("tools/call", (request) =>
    Effect.gen(function* () {
      const token = progressTokenOf(request.params);
      yield* Effect.forkDetach(
        Effect.sleep("40 millis").pipe(Effect.andThen(sendProgress(server, token))),
      );
      yield* Effect.sleep("80 millis");
      return { content: [{ text: "done", type: "text" }] };
    }),
  );
  const progress = vi.fn();
  const result = client.callTool("slow", {}, { onProgress: progress, timeoutMs: 50 });
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(40));
  yield* Effect.promise(() => vi.advanceTimersByTimeAsync(40));
  expect(yield* Effect.promise(() => result)).toEqual({
    content: [{ text: "done", type: "text" }],
  });
  expect(progress).toHaveBeenCalledWith({ progress: 1, progressToken: 2, total: 2 });
  yield* Effect.promise(() => client.close());
});

const cancelsRequests = Effect.gen(function* () {
  const { client, server } = yield* connect();
  server.setHandler("tools/call", () => Effect.never);
  const controller = abortController();
  const aborted = client.callTool("wait", {}, { signal: controller.signal });
  controller.abort("stop");
  yield* Effect.promise(() => expect(aborted).rejects.toBeInstanceOf(McpAbortError));
  yield* yieldMacrotask;
  expect(server.messages).toContainEqual({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { reason: "stop", requestId: 2 },
  });
  yield* Effect.promise(() =>
    expect(client.callTool("wait", {}, { timeoutMs: 5 })).rejects.toBeInstanceOf(McpTimeoutError),
  );
  yield* Effect.promise(() => client.close());
});

const reportsTransportErrors = Effect.gen(function* () {
  const { clientTransport, server } = yield* createServer();
  const client = new McpClient({ name: "test-client", version: "1.0.0" });
  yield* Effect.promise(() => client.connect(clientTransport));
  const errors: Error[] = [];
  client.onError((error) => errors.push(error));
  const gate = Deferred.makeUnsafe<void>();
  server.setHandler("tools/call", () => Deferred.await(gate).pipe(Effect.as({ content: [] })));
  const call = client.callTool("wait");
  yield* yieldMacrotask;
  clientTransport.emitError(new Error("stray log line"));
  Deferred.doneUnsafe(gate, Effect.void);
  expect(yield* Effect.promise(() => call)).toEqual({ content: [] });
  expect(errors.map((error) => error.message)).toEqual(["stray log line"]);
  yield* Effect.promise(() => client.close());
});

const acceptsOlderProtocol = Effect.gen(function* () {
  const { clientTransport, server } = yield* createServer();
  server.setHandler("initialize", () =>
    Effect.succeed({
      capabilities: {},
      protocolVersion: "2024-11-05",
      serverInfo: { name: "old-server", version: "0.1.0" },
    }),
  );
  const client = new McpClient({ name: "test-client", version: "1.0.0" });
  yield* Effect.promise(() => client.connect(clientTransport));
  expect(client.protocolVersion).toBe("2024-11-05");
  yield* Effect.promise(() => client.close());

  const unsupported = yield* createServer();
  unsupported.server.setHandler("initialize", () =>
    Effect.succeed({
      capabilities: {},
      protocolVersion: "1999-01-01",
      serverInfo: { name: "ancient-server", version: "0.1.0" },
    }),
  );
  const rejected = new McpClient({ name: "test-client", version: "1.0.0" });
  yield* Effect.promise(() =>
    expect(rejected.connect(unsupported.clientTransport)).rejects.toThrow(
      "unsupported protocol version",
    ),
  );
  expect(rejected.connectionState).toBe("closed");
});

const skipsCancelForInitialize = Effect.gen(function* () {
  const { clientTransport, server } = yield* createServer();
  server.setHandler("initialize", () => Effect.never);
  const client = new McpClient({ name: "test-client", requestTimeoutMs: 5, version: "1.0.0" });
  yield* Effect.promise(() =>
    expect(client.connect(clientTransport)).rejects.toBeInstanceOf(McpTimeoutError),
  );
  yield* yieldMacrotask;
  expect(
    server.messages.some(
      (message) => "method" in message && message.method === "notifications/cancelled",
    ),
  ).toBe(false);
});

const notifiesCloseOnce = Effect.gen(function* () {
  const { client, server } = yield* connect();
  const closed = vi.fn();
  client.onClose(closed);
  server.setHandler("tools/call", () => Effect.never);
  const pending = client.callTool("wait");
  yield* yieldMacrotask;
  yield* Effect.promise(() => server.transport.close());
  yield* Effect.promise(() => expect(pending).rejects.toThrow("MCP connection closed"));
  expect(client.connectionState).toBe("closed");
  yield* Effect.promise(() => client.close());
  expect(closed).toHaveBeenCalledTimes(1);
});

const answersRoots = Effect.gen(function* () {
  const { clientTransport, server } = yield* createServer();
  const client = new McpClient({
    name: "test-client",
    roots: [{ name: "workspace", uri: "file:///workspace" }],
    version: "1.0.0",
  });
  yield* Effect.promise(() => client.connect(clientTransport));
  const changed = vi.fn();
  client.onNotification("notifications/tools/list_changed", changed);
  yield* Effect.promise(() =>
    server.transport.send({ id: "roots", jsonrpc: "2.0", method: "roots/list" }),
  );
  yield* Effect.promise(() =>
    server.transport.send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }),
  );
  yield* yieldMacrotask;
  expect(server.messages).toContainEqual({
    id: "roots",
    jsonrpc: "2.0",
    result: { roots: [{ name: "workspace", uri: "file:///workspace" }] },
  });
  expect(changed).toHaveBeenCalledWith(undefined);
  yield* Effect.promise(() => client.close());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("McpClient lifecycle", () => {
  it("renews the timeout on progress", () => Effect.runPromise(renewsTimeout));
  it("cancels aborted and timed-out requests", () => Effect.runPromise(cancelsRequests));
  it("reports transport errors without failing pending requests", () =>
    Effect.runPromise(reportsTransportErrors));
  it("accepts servers that answer with an older protocol version", () =>
    Effect.runPromise(acceptsOlderProtocol));
  it("does not send notifications/cancelled for a timed-out initialize", () =>
    Effect.runPromise(skipsCancelForInitialize));
  it("notifies close listeners once when the transport drops", () =>
    Effect.runPromise(notifiesCloseOnce));
  it("answers roots/list and dispatches notifications", () => Effect.runPromise(answersRoots));
});
