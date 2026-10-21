import type configTypes from "./config.types.ts";
import type runtimeTypes from "./runtime.types.ts";

declare namespace extensionInternalTypes {
  interface McpServer {
    entry: configTypes.McpServerEntry;
    connection?: runtimeTypes.McpServerConnection | undefined;

    registeredConfig?: string;

    message?: string | undefined;

    attempt?: symbol | undefined;

    ready?: Promise<void>;

    closing?: Promise<void> | undefined;
  }
}

export type { extensionInternalTypes as default };
