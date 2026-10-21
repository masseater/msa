import type McpSignInCancelledErrorClass from "./sign-in-cancelled.ts";

declare namespace signInCancelledTypes {
  type McpSignInCancelledError = (typeof McpSignInCancelledErrorClass)["prototype"];
}

export type { signInCancelledTypes as default };
