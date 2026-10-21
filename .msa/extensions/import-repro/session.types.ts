import type session from "./session.ts";

declare namespace sessionTypes {
  interface SessionHeader {
    type: "session";
    id: string;
    cwd: string;
    [key: string]: unknown;
  }

  interface DecodedSession {
    header: SessionHeader;
    jsonl: string;
  }

  type SessionRef =
    | { type: "gist"; id: string }
    | { type: "file"; path: string }
    | { type: "issue"; owner: string; repo: string; issue: string };

  type IssueRef = Extract<SessionRef, { type: "issue" }>;

  type ImportReproError = (typeof session.ImportReproError)["prototype"];
}

export type { sessionTypes as default };
