import type autoSinceTypes from "./auto-since.types.ts";
import type editReplacementTypes from "./edit-replacement.types.ts";

declare namespace editToolScanTypes {
  interface EditRecord extends editReplacementTypes.EditAnalysis {
    readonly sessionFile: string;
    readonly assistantEntryId: string | undefined;
    readonly toolCallId: string;
    readonly timestamp: string | undefined;
    readonly api: string | null;
    readonly provider: string;
    readonly model: string;
    readonly providerModel: string;
    success: boolean | null;
    errorKind: string | null;
    errorText: string;
    resultSummary: string;
    matchedResult: boolean;
  }

  interface EditScanMeta {
    sessionsDir: string;
    sessionFilesScanned: number;
    sessionFilesIncluded: number;
    sessionFilesSkippedOlderThanSince: number;
    sessionFilesWithEditCalls: number;
    since: autoSinceTypes.SinceFilter | null;
    malformedLines: number;
    unmatchedToolResults: number;
  }
}

export type { editToolScanTypes as default };
