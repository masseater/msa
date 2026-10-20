import type nodeFsTypes from "./platform/node/fs.types.ts";

declare namespace sessionManagerInternalTypes {
  interface SessionFileCandidate {
    path: string;
    stats?: nodeFsTypes.Stats;
  }
}

export type { sessionManagerInternalTypes as default };
