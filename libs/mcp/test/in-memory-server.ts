import { Effect } from "effect";

import mcp from "../src/index.ts";
import type mcpTypes from "../src/index.types.ts";
import testing from "../src/testing/index.ts";
import type testingTypes from "../src/testing/index.types.ts";
import type inMemoryServerTypes from "./in-memory-server.types.ts";

const { LATEST_PROTOCOL_VERSION, McpClient, McpError } = mcp;
const { createInMemoryTransportPair } = testing;

const respond = (
  transport: testingTypes.InMemoryTransport,
  request: mcpTypes.JsonRpcRequest,
  handler: inMemoryServerTypes.TestHandler | undefined,
): Effect.Effect<void> =>
  (handler === undefined
    ? Effect.fail(McpError.create(-32601, `Method not found: ${request.method}`))
    : handler(request)
  ).pipe(
    Effect.flatMap((result) =>
      Effect.promise(() => transport.send({ id: request.id, jsonrpc: "2.0", result })),
    ),
    Effect.catch((error) =>
      Effect.promise(() =>
        transport.send({
          error: { code: error.code, data: error.data, message: error.message },
          id: request.id,
          jsonrpc: "2.0",
        }),
      ),
    ),
  );

const createServer = Effect.fn("createServer")(function* () {
  const pair = createInMemoryTransportPair();
  const handlers = new Map<string, inMemoryServerTypes.TestHandler>();
  const messages: mcpTypes.JsonRpcMessage[] = [];
  const context = yield* Effect.context();
  pair.server.onMessage((message) => {
    messages.push(message);
    if (!("id" in message) || !("method" in message)) return;
    const request = message as mcpTypes.JsonRpcRequest;
    const handler = handlers.get(request.method);
    queueMicrotask(() => {
      Effect.runForkWith(context)(respond(pair.server, request, handler));
    });
  });
  yield* Effect.promise(() => pair.server.start());
  const server: inMemoryServerTypes.TestServer = {
    messages,
    setHandler(method, handler) {
      handlers.set(method, handler);
    },
    transport: pair.server,
  };
  server.setHandler("initialize", () =>
    Effect.succeed({
      capabilities: { tools: { listChanged: true } },
      instructions: "Use test tools.",
      protocolVersion: LATEST_PROTOCOL_VERSION,
      serverInfo: { name: "test-server", version: "1.0.0" },
    }),
  );
  return { clientTransport: pair.client, server };
});

const connect = Effect.fn("connect")(function* () {
  const { clientTransport, server } = yield* createServer();
  const client = new McpClient({ name: "test-client", version: "2.0.0" });
  yield* Effect.promise(() => client.connect(clientTransport));
  return { client, server };
});

const inMemoryServer = {
  connect,
  createServer,
};

export default inMemoryServer;
