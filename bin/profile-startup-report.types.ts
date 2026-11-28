declare namespace profileStartupReportTypes {
  interface RunResult {
    readonly elapsedMs: number;
    readonly profilePath: string | undefined;
    readonly timings: ReadonlyMap<string, number>;
  }

  interface ReportContext {
    readonly cpuProfile: boolean;
    readonly displayPath: (path: string) => string;
    readonly mode: string;
    readonly profileDir: string;
    readonly runtimeLabel: string;
  }
}

export type { profileStartupReportTypes as default };
