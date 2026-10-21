import type mcpTypes from "@msa/mcp/index.types";
import type testingTypes from "@msa/mcp/testing.types";

import type runtimeTypes from "../src/extensions/mcp/runtime.types.ts";
import type codingAgentTypes from "../src/index.types.ts";

declare namespace mcpConnectionSupportTypes {
  interface TransportOptions {
    expireFirstCall?: boolean;
    methods?: string[];
    noTools?: boolean;
    resources?: boolean;
  }

  type FakeServer = testingTypes.InMemoryTransport;

  type JsonRpcMessage = mcpTypes.JsonRpcMessage;

  type ServerEntry = codingAgentTypes.McpServerEntry;

  type ServerLog = runtimeTypes.McpServerLog;
}

export type { mcpConnectionSupportTypes as default };
