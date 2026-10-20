import type MissingSessionCwdErrorClass from "./missing-session-cwd-error.ts";

declare namespace sessionCwdTypes {
  interface SessionCwdIssue {
    sessionFile?: string;
    sessionCwd: string;
    fallbackCwd: string;
  }

  type MissingSessionCwdError = (typeof MissingSessionCwdErrorClass)["prototype"];
}

export type { sessionCwdTypes as default };
