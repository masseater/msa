declare namespace toolStatsReportTypes {
  interface HistogramRow {
    readonly avg: number;
    readonly calls: number;
    readonly estimatedTokens: number;
    readonly histogram: ReadonlyArray<number>;
    readonly name: string;
    readonly results?: number;
    readonly samples: ReadonlyArray<number>;
  }

  interface ReportData {
    readonly bashCommands: ReadonlyArray<HistogramRow>;
    readonly bucketLabels: ReadonlyArray<string>;
    readonly files: number;
    readonly generatedAt: string;
    readonly parseErrors: number;
    readonly sessionsDir: string;
    readonly tools: ReadonlyArray<HistogramRow>;
  }
}

export type { toolStatsReportTypes as default };
