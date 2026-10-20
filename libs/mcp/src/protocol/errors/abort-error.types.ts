import type McpAbortErrorClass from "./abort-error.ts";

declare namespace abortErrorTypes {
  type McpAbortError = McpAbortErrorClass;
}

export type { abortErrorTypes as default };
