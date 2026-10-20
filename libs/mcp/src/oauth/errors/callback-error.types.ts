import type OAuthCallbackErrorClass from "./callback-error.ts";

declare namespace callbackErrorTypes {
  type OAuthCallbackError = OAuthCallbackErrorClass;
}

export type { callbackErrorTypes as default };
