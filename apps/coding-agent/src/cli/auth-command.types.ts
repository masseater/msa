import type AuthCommandErrorClass from "./auth-command-error.ts";

declare namespace authCommandTypes {
  type AuthCommandKind = "check" | "api_key" | "bearer_token";

  interface AuthCommand {
    kind: AuthCommandKind;
    args: string[];
    json: boolean;
    credentials: boolean;
    noRefresh: boolean;
    minExpiryMs?: number;
  }

  type AuthCommandError = (typeof AuthCommandErrorClass)["prototype"];
}

export type { authCommandTypes as default };
