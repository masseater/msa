import type McpTimeoutErrorClass from "./timeout-error.ts";

declare namespace timeoutErrorTypes {
  type McpTimeoutError = McpTimeoutErrorClass;
}

export type { timeoutErrorTypes as default };
