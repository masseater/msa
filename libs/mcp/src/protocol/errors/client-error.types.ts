import type McpClientErrorClass from "./client-error.ts";

declare namespace clientErrorTypes {
  type McpClientError = McpClientErrorClass;
}

export type { clientErrorTypes as default };
