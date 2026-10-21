import type extensionsTypesTypes from "../../src/core/extensions/types.types.ts";
import type configTypes from "../../src/extensions/mcp/config.types.ts";
import type harnessTypes from "./harness.types.ts";
import type mcpFakeServer from "./mcp-fake-server.ts";
import type mcpFakeServerTypes from "./mcp-fake-server.types.ts";

declare namespace agentSessionMcpHarnessTypes {
  type FakeServer = ReturnType<(typeof mcpFakeServer)["createFakeServer"]>["server"];

  interface Input {
    readonly config?: Record<string, unknown>;
    readonly entry: configTypes.McpServerEntry;
    readonly extensionFactories?: extensionsTypesTypes.ExtensionFactory[];
    readonly harness: harnessTypes.HarnessOptions;
    readonly server: mcpFakeServerTypes.Options;
    readonly startupWaitMs?: number;
    readonly withoutToolSearch?: boolean;
  }
}

export type { agentSessionMcpHarnessTypes as default };
