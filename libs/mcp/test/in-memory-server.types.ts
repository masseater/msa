import type { Effect } from "effect";

import type mcpTypes from "../src/index.types.ts";
import type testingTypes from "../src/testing/index.types.ts";

declare namespace inMemoryServerTypes {
  type TestHandler = (
    request: mcpTypes.JsonRpcRequest,
  ) => Effect.Effect<unknown, mcpTypes.McpError>;

  interface TestServer {
    transport: testingTypes.InMemoryTransport;
    messages: mcpTypes.JsonRpcMessage[];
    setHandler(method: string, handler: TestHandler): void;
  }
}

export type { inMemoryServerTypes as default };
