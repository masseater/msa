import type nodeFsTypes from "./platform/node/fs.types.ts";
import type sessionManagerTypes from "./session-manager.types.ts";

declare namespace sessionManagerInternalTypes {
  interface SessionFileCandidate {
    path: string;
    stats?: nodeFsTypes.Stats;
  }

  type LoadedSessionFile = { entries: sessionManagerTypes.FileEntry[]; size: number } | null;

  interface SessionManagerInit {
    cwd: string;
    sessionDir: string;
    persist: boolean;
    newSessionOptions?: sessionManagerTypes.NewSessionOptions | undefined;
    entries?: sessionManagerTypes.FileEntry[] | undefined;
    file?: { path: string; loaded: LoadedSessionFile } | undefined;
  }
}

export type { sessionManagerInternalTypes as default };
