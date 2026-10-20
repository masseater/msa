import type McpAuthRequiredErrorClass from "./auth-required-error.ts";

declare namespace authRequiredErrorTypes {
  type McpAuthRequiredError = McpAuthRequiredErrorClass;
}

export type { authRequiredErrorTypes as default };
