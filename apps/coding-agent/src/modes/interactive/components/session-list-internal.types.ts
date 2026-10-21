import type sessionManagerTypes from "../../../core/session-manager.types.ts";

declare namespace sessionListInternalTypes {
  interface SessionTreeNode {
    session: sessionManagerTypes.SessionInfo;
    children: SessionTreeNode[];
    latestActivity: number;
  }

  interface FlatSessionNode {
    session: sessionManagerTypes.SessionInfo;
    depth: number;
    isLast: boolean;
    ancestorContinues: boolean[];
  }
}

export type { sessionListInternalTypes as default };
