import type sessionManagerTypes from "../../../core/session-manager.types.ts";

declare namespace sessionSelectorInternalTypes {
  type SessionScope = "current" | "all";

  type SessionsLoader = (
    onProgress?: sessionManagerTypes.SessionListProgress,
    signal?: AbortSignal,
  ) => Promise<sessionManagerTypes.SessionInfo[]>;
}

export type { sessionSelectorInternalTypes as default };
