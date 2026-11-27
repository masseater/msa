import type readToolScanTypes from "./read-tool-scan.types.ts";

declare namespace readToolSummaryTypes {
  interface GroupStats {
    readonly key: string;
    readonly reads: number;
    readonly assistantMessages: number;
    readonly full: number;
    readonly partial: number;
    readonly fullRate: number | null;
    readonly partialRate: number | null;
  }

  interface NormalizedStats {
    readonly key: string;
    readonly sessions: number;
    readonly reads: number;
    readonly full: number;
    readonly partial: number;
    readonly readsPerSession: number | null;
    readonly fullPerSession: number | null;
    readonly partialPerSession: number | null;
    readonly medianSessionPartialRate: number | null;
  }

  interface ProviderStats extends GroupStats {
    readonly providerModel: string;
    readonly timeStats: ReadonlyArray<GroupStats>;
    readonly normalizedTimeStats: ReadonlyArray<NormalizedStats>;
    readonly timeOfDayStats: ReadonlyArray<GroupStats>;
    readonly normalizedTimeOfDayStats: ReadonlyArray<NormalizedStats>;
  }

  interface ReadSummary {
    readonly filters: { readonly model: string | null; readonly bucket: string };
    readonly scan: {
      readonly sessionsDir: string;
      readonly sessionFilesScanned: number;
      readonly sessionFilesIncluded: number;
      readonly sessionFilesSkippedOlderThanSince: number;
      readonly sessionFilesWithReadCalls: number;
      readonly since: { readonly ms: number; readonly iso: string; readonly source: string } | null;
      readonly malformedLines: number;
    };
    readonly counts: {
      readonly assistantMessagesWithReadCalls: number;
      readonly totalReadCalls: number;
      readonly full: number;
      readonly partial: number;
      readonly fullRate: number | null;
      readonly partialRate: number | null;
    };
    readonly providerStats: ReadonlyArray<GroupStats>;
    readonly timeStats: ReadonlyArray<GroupStats>;
    readonly normalizedTimeStats: ReadonlyArray<NormalizedStats>;
    readonly timeOfDayStats: ReadonlyArray<GroupStats>;
    readonly normalizedTimeOfDayStats: ReadonlyArray<NormalizedStats>;
    readonly timeStatsByProvider: ReadonlyArray<ProviderStats>;
    readonly examples: ReadonlyArray<readToolScanTypes.ReadRecord>;
  }
}

export type { readToolSummaryTypes as default };
