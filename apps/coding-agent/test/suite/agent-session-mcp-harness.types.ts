import type { ExtensionFactory } from "../../src/core/extensions/types.ts";
import type { McpServerEntry } from "../../src/extensions/mcp/config.ts";
import type harnessTypes from "./harness.types.ts";
import type mcpFakeServer from "./mcp-fake-server.ts";
import type mcpFakeServerTypes from "./mcp-fake-server.types.ts";

declare namespace agentSessionMcpHarnessTypes {
  type FakeServer = ReturnType<(typeof mcpFakeServer)["createFakeServer"]>["server"];

  interface Input {
    readonly config?: Record<string, unknown>;
    readonly entry: McpServerEntry;
    readonly extensionFactories?: ExtensionFactory[];
    readonly harness: harnessTypes.HarnessOptions;
    readonly server: mcpFakeServerTypes.Options;
    readonly startupWaitMs?: number;
    readonly withoutToolSearch?: boolean;
  }
}

export type { agentSessionMcpHarnessTypes as default };
