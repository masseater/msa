import type sessionsSchema from "./sessions-schema.ts";

declare namespace sessionsTypes {
  type Cost = typeof sessionsSchema.CostSchema.Type;

  type Usage = typeof sessionsSchema.UsageSchema.Type;

  type SessionEntry = typeof sessionsSchema.SessionEntrySchema.Type;

  interface SessionFileCounts {
    sessionFilesScanned: number;
    sessionFilesIncluded: number;
    sessionFilesSkippedOlderThanSince: number;
  }
}

export type { sessionsTypes as default };
