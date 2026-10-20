import type repoStateTypes from "./repo-state.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

declare namespace replanApplyInternalTypes {
  interface Handoff {
    taskId: string;
    threadId: string;
    title: string;
    memo: string;
    repo: repoStateTypes.RepoState;
  }

  interface Creation {
    created: orchestratorTypesTypes.ReplanCreated[];
    inheritors: Map<string, string[]>;
    byKey: Map<string, string>;
  }
}

export type { replanApplyInternalTypes as default };
