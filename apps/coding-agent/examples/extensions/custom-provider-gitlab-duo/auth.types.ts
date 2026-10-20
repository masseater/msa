import type GitLabAuthErrorClass from "./git-lab-auth-error.ts";

declare namespace authTypes {
  type GitLabAuthError = (typeof GitLabAuthErrorClass)["prototype"];
}

export type { authTypes as default };
