import type McpConnectionClosedErrorClass from "./connection-closed-error.ts";

declare namespace connectionClosedErrorTypes {
  type McpConnectionClosedError = McpConnectionClosedErrorClass;
}

export type { connectionClosedErrorTypes as default };
