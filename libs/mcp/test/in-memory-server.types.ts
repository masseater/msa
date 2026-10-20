import type { Effect } from "effect";

import type { JsonRpcMessage, JsonRpcRequest, McpError } from "../src/index.ts";
import type { InMemoryTransport } from "../src/testing/index.ts";

declare namespace inMemoryServerTypes {
  type TestHandler = (request: JsonRpcRequest) => Effect.Effect<unknown, McpError>;

  interface TestServer {
    transport: InMemoryTransport;
    messages: JsonRpcMessage[];
    setHandler(method: string, handler: TestHandler): void;
  }
}

export type { inMemoryServerTypes as default };
