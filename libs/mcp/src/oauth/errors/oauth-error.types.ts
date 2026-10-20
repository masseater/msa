import type OAuthErrorClass from "./oauth-error.ts";

declare namespace oauthErrorTypes {
  type OAuthError = OAuthErrorClass;
}

export type { oauthErrorTypes as default };
