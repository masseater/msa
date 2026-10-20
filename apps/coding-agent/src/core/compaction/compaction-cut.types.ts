import type sessionManagerTypes from "../session-manager.types.ts";

declare namespace compactionCutTypes {
  interface ProjectedCutInput {
    entries: sessionManagerTypes.ProjectedSessionEntry[];
    startIndex: number;
    endIndex: number;
    keepRecentTokens: number;
  }
}

export type { compactionCutTypes as default };
