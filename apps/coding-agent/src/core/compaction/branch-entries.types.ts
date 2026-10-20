import type agentTypes from "@msa/agent-core/index.types";

import type sessionManagerTypes from "../session-manager.types.ts";
import type utilsTypes from "./utils.types.ts";

declare namespace branchEntriesTypes {
  interface BranchPreparation {
    messages: agentTypes.AgentMessage[];
    fileOps: utilsTypes.FileOperations;
    totalTokens: number;
  }

  interface CollectEntriesResult {
    entries: sessionManagerTypes.SessionEntry[];
    commonAncestorId: string | null;
  }

  interface BranchSummaryDetails {
    readFiles: string[];
    modifiedFiles: string[];
  }
}

export type { branchEntriesTypes as default };
