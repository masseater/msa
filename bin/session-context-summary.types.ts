import type sessionContextScanTypes from "./session-context-scan.types.ts";

declare namespace sessionContextSummaryTypes {
  interface GroupSummary {
    readonly key: string;
    readonly sessions: number;
    readonly contextWindows: ReadonlyArray<number>;
    readonly assistantMessages: number;
    readonly avgTurns: number;
    readonly avgDurationMinutes: number;
    readonly avgMaxPromptTokens: number | null;
    readonly medianMaxPromptTokens: number | null;
    readonly avgMaxContextUsagePercent: number | null;
    readonly medianMaxContextUsagePercent: number | null;
    readonly medianPreFirstCompactionUsagePercent: number | null;
    readonly contextKnownSessions: number;
    readonly sessionsWithCompaction: number;
    readonly totalCompactions: number;
    readonly compactionRate: number;
    readonly over80: number;
    readonly over90: number;
    readonly over100: number;
  }

  interface ModelSummary extends GroupSummary {
    readonly byDay: ReadonlyArray<GroupSummary>;
  }

  interface SummaryFilters {
    readonly bashContains: ReadonlyArray<string>;
    readonly cwd: string | null;
    readonly model: string | null;
    readonly modelPrefixes: ReadonlyArray<string>;
  }

  interface Summary {
    readonly filters: SummaryFilters;
    readonly scan: sessionContextScanTypes.ScanMeta & {
      readonly contextWindowSources: ReadonlyArray<string>;
      readonly timezone: string;
    };
    readonly totals: GroupSummary;
    readonly byDay: ReadonlyArray<GroupSummary>;
    readonly byModel: ReadonlyArray<GroupSummary>;
    readonly byModelDay: ReadonlyArray<ModelSummary>;
  }
}

export type { sessionContextSummaryTypes as default };
