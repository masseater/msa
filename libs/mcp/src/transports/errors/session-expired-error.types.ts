import type McpSessionExpiredErrorClass from "./session-expired-error.ts";

declare namespace sessionExpiredErrorTypes {
  type McpSessionExpiredError = McpSessionExpiredErrorClass;
}

export type { sessionExpiredErrorTypes as default };
