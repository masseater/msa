import type clientCoreTypes from "./client-core.types.ts";
import type McpClientClass from "./client.ts";
import type typesModule from "./protocol/types.types.ts";

declare namespace clientTypes {
  interface McpClientOptions extends typesModule.Implementation {
    capabilities?: typesModule.ClientCapabilities;
    protocolVersion?: typesModule.SupportedProtocolVersion;
    requestTimeoutMs?: number;
    roots?:
      | readonly typesModule.Root[]
      | (() => readonly typesModule.Root[] | Promise<readonly typesModule.Root[]>);
  }

  type McpRequestOptions = clientCoreTypes.McpRequestOptions;

  type McpClient = McpClientClass;
}

export type { clientTypes as default };
