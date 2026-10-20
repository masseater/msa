declare namespace sessionContextScanTypes {
  interface SessionRecord {
    sessionFile: string;
    cwd: string | null;
    startMs: number;
    endMs: number;
    providerModel: string;
    assistantMessages: number;
    userMessages: number;
    compactions: number;
    seenCompaction: boolean;
    maxPromptTokens: number | null;
    preFirstCompactionTokens: number | null;
    maxContextUsagePercent: number | null;
    preFirstCompactionUsagePercent: number | null;
    contextWindow: number | null;
    bashCommands: Array<string>;
    over80: boolean;
    over90: boolean;
    over100: boolean;
  }

  interface ScanMeta {
    sessionsDir: string;
    sessionFilesScanned: number;
    sessionFilesIncluded: number;
    sessionFilesSkippedOlderThanSince: number;
    malformedLines: number;
  }
}

export type { sessionContextScanTypes as default };
