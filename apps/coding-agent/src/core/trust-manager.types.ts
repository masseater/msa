import type ProjectTrustStoreClass from "./project-trust-store.ts";

declare namespace trustManagerTypes {
  type ProjectTrustDecision = boolean | null;

  interface ProjectTrustStoreEntry {
    path: string;
    decision: boolean;
  }

  interface ProjectTrustUpdate {
    path: string;
    decision: ProjectTrustDecision;
  }

  interface ProjectTrustOption {
    label: string;
    trusted: boolean;
    updates: ProjectTrustUpdate[];
    savedPath?: string;
  }

  type ProjectTrustStore = (typeof ProjectTrustStoreClass)["prototype"];
}

export type { trustManagerTypes as default };
