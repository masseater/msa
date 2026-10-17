import { Effect } from "effect";

import {
  type JsonRpcMessage,
  type JsonRpcRequest,
  LATEST_PROTOCOL_VERSION,
  McpClient,
  McpError,
} from "../src/index.ts";
import { createInMemoryTransportPair, type InMemoryTransport } from "../src/testing/index.ts";

export type TestHandler = (request: JsonRpcRequest) => Effect.Effect<unknown, McpError>;

export interface TestServer {
  transport: InMemoryTransport;
  messages: JsonRpcMessage[];
  setHandler(method: string, handler: TestHandler): void;
}

const respond = (
  transport: InMemoryTransport,
  request: JsonRpcRequest,
  handler: TestHandler | undefined,
): Effect.Effect<void> =>
  (handler === undefined
    ? Effect.fail(new McpError(-32601, `Method not found: ${request.method}`))
    : handler(request)
  ).pipe(
    Effect.flatMap((result) =>
      Effect.promise(() => transport.send({ jsonrpc: "2.0", id: request.id, result })),
    ),
    Effect.catch((error) =>
      Effect.promise(() =>
        transport.send({
          jsonrpc: "2.0",
          id: request.id,
          error: { code: error.code, message: error.message, data: error.data },
        }),
      ),
    ),
  );

export const createServer = Effect.fn("createServer")(function* () {
  const pair = createInMemoryTransportPair();
  const handlers = new Map<string, TestHandler>();
  const messages: JsonRpcMessage[] = [];
  const context = yield* Effect.context();
  pair.server.onMessage((message) => {
    messages.push(message);
    if (!("id" in message) || !("method" in message)) return;
    const request = message as JsonRpcRequest;
    const handler = handlers.get(request.method);
    queueMicrotask(() => {
      Effect.runForkWith(context)(respond(pair.server, request, handler));
    });
  });
  yield* Effect.promise(() => pair.server.start());
  const server: TestServer = {
    transport: pair.server,
    messages,
    setHandler(method, handler) {
      handlers.set(method, handler);
    },
  };
  server.setHandler("initialize", () =>
    Effect.succeed({
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "test-server", version: "1.0.0" },
      instructions: "Use test tools.",
    }),
  );
  return { clientTransport: pair.client, server };
});

export const connect = Effect.fn("connect")(function* () {
  const { clientTransport, server } = yield* createServer();
  const client = new McpClient({ name: "test-client", version: "2.0.0" });
  yield* Effect.promise(() => client.connect(clientTransport));
  return { client, server };
});
