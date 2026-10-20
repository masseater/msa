import type bugReport from "./bug-report.ts";

declare namespace bugReportTypes {
  type BugReportMetadata = ReturnType<typeof bugReport.collectBugReportMetadata>;

  type BugReportDiagnostics = ReturnType<typeof bugReport.collectBugReportDiagnostics>;

  interface BugReportBundle {
    metadata: BugReportMetadata;
    diagnostics: BugReportDiagnostics;
    sessionJsonl?: string | undefined;
    summary?: string | undefined;
  }

  interface BugReportSessionEntryData {
    id: string;
    createdAt: string;
    hint: string | null;
    sessionIncluded: boolean;
    summaryIncluded: boolean;
    delivery: "zip";
    path?: string;
  }
}

export type { bugReportTypes as default };
