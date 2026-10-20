import type autoSinceTypes from "./auto-since.types.ts";
import type hostTypes from "./host.types.ts";

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

  interface SessionScanRequest {
    readonly host: hostTypes.HostShape;
    readonly sessionsDir: string;
    readonly since: autoSinceTypes.SinceFilter | null;
  }
}

export type { scanOptionsTypes as default };
