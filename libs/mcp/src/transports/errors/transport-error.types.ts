import type McpTransportErrorClass from "./transport-error.ts";

declare namespace transportErrorTypes {
  type McpTransportError = McpTransportErrorClass;
}

export type { transportErrorTypes as default };
