declare namespace crashLogTypes {
  interface CrashRecord {
    timestamp: string;
    version: string;
    kind: "uncaught_exception" | "fatal_error";
    message: string;
    stack: string | null;
    sessionFile: string | null;
    cwd: string;
    notified?: boolean;
  }
}

export type { crashLogTypes as default };
