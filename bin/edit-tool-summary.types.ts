import type editToolBucketsTypes from "./edit-tool-buckets.types.ts";

declare namespace editToolSummaryTypes {
  interface EditGroupStats {
    readonly key: string;
    readonly calls: number;
    readonly resolved: number;
    readonly success: number;
    readonly failed: number;
    readonly unresolved: number;
    readonly multi: number;
    readonly multiRate: number | null;
    readonly successRate: number | null;
    readonly medianInflation: number | null;
    readonly p95Inflation: number | null;
  }

  interface EditSummary {
    readonly filters: {
      readonly model: string | null;
      readonly extension: string | null;
      readonly failedOnly: boolean;
    };
    readonly scan: {
      readonly sessionsDir: string;
      readonly sessionFilesScanned: number;
      readonly sessionFilesIncluded: number;
      readonly sessionFilesSkippedOlderThanSince: number;
      readonly sessionFilesWithEditCalls: number;
      readonly since: { readonly ms: number; readonly iso: string; readonly source: string } | null;
      readonly malformedLines: number;
      readonly unmatchedToolResults: number;
    };
    readonly counts: {
      readonly assistantMessagesWithEditCalls: number;
      readonly totalEditCalls: number;
      readonly resolvedEditCalls: number;
      readonly success: number;
      readonly failed: number;
      readonly unresolved: number;
      readonly single: number;
      readonly multi: number;
      readonly noCoreChange: number;
    };
    readonly modeStats: ReadonlyArray<editToolBucketsTypes.ModeStats>;
    readonly multiEditLengthBuckets: ReadonlyArray<editToolBucketsTypes.LengthBucket>;
    readonly argStyles: ReadonlyArray<{ readonly style: string; readonly count: number }>;
    readonly providerStats: ReadonlyArray<EditGroupStats>;
    readonly extensionStats: ReadonlyArray<EditGroupStats>;
    readonly inflation: {
      readonly median: number | null;
      readonly p90: number | null;
      readonly p95: number | null;
      readonly p99: number | null;
      readonly pathologicalThresholds: ReadonlyArray<editToolBucketsTypes.Threshold>;
      readonly hugeReplacements: ReadonlyArray<editToolBucketsTypes.Threshold>;
      readonly failureByBucket: ReadonlyArray<editToolBucketsTypes.InflationBucket>;
    };
    readonly sameFileClusters: editToolBucketsTypes.ClusterStats;
    readonly failureKinds: ReadonlyArray<{ readonly kind: string; readonly count: number }>;
    readonly worstExamples: ReadonlyArray<editToolBucketsTypes.WorstExample>;
  }
}

export type { editToolSummaryTypes as default };
