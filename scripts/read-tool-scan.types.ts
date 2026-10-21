import type autoSinceTypes from "./auto-since.types.ts";

declare namespace readToolScanTypes {
  interface ReadRecord {
    readonly sessionFile: string;
    readonly assistantEntryId: string | undefined;
    readonly toolCallId: string;
    readonly timestamp: string | undefined;
    readonly timestampMs: number;
    readonly api: string | null;
    readonly provider: string;
    readonly model: string;
    readonly providerModel: string;
    readonly path: string;
    readonly offset: unknown;
    readonly limit: unknown;
    readonly mode: "full" | "partial";
  }

  interface ReadScanMeta {
    sessionsDir: string;
    sessionFilesScanned: number;
    sessionFilesIncluded: number;
    sessionFilesSkippedOlderThanSince: number;
    sessionFilesWithReadCalls: number;
    since: autoSinceTypes.SinceFilter | null;
    malformedLines: number;
  }
}

export type { readToolScanTypes as default };
