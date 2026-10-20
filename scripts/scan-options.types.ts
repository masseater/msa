declare namespace scanOptionsTypes {
  interface ScanArgs {
    allSessions: boolean;
    autoSincePath: string | undefined;
    includeRecords: boolean;
    json: boolean;
    modelFilter: string | undefined;
    sessionsDir: string;
    since: string | undefined;
    top: number;
  }
}

export type { scanOptionsTypes as default };
