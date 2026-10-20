import type McpClientCoreClass from "./client-core.ts";
import type typesModule from "./protocol/types.types.ts";

declare namespace clientCoreTypes {
  type ClientState = "idle" | "connecting" | "connected" | "closed";

  interface McpRequestOptions {
    signal?: AbortSignal | undefined;
    timeoutMs?: number;
    onProgress?: (progress: typesModule.ProgressNotification) => void;
  }

  type McpClientCore = McpClientCoreClass;
}

export type { clientCoreTypes as default };
