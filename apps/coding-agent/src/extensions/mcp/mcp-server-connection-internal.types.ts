declare namespace mcpServerConnectionInternalTypes {
  type ServerState =
    | "connecting"
    | "connected"
    | "disconnected"
    | "needs-auth"
    | "failed"
    | "closed";
}

export type { mcpServerConnectionInternalTypes as default };
