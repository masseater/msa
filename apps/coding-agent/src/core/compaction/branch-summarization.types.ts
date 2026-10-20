import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import type aiTypes from "@msa/ai/index.types";

import type branchEntriesTypes from "./branch-entries.types.ts";
import type utilsTypes from "./utils.types.ts";

declare namespace branchSummarizationTypes {
  interface BranchSummaryResult {
    summary?: string;
    usage?: compatTypes.Usage | undefined;
    readFiles?: string[];
    modifiedFiles?: string[];
    aborted?: boolean;
    error?: string;
  }

  interface GenerateBranchSummaryOptions {
    model: compatTypes.Model<any>;
    apiKey?: string | undefined;
    headers?: Record<string, string> | undefined;
    env?: Record<string, string> | undefined;
    signal: AbortSignal;
    customInstructions?: string | undefined;
    replaceInstructions?: boolean | undefined;
    reserveTokens?: number;
    streamFn?: agentTypes.StreamFn;
    retry?: aiTypes.RetryPolicy;
    callbacks?: aiTypes.RetryCallbacks;
  }

  type BranchPreparation = branchEntriesTypes.BranchPreparation;

  type BranchSummaryDetails = branchEntriesTypes.BranchSummaryDetails;

  type CollectEntriesResult = branchEntriesTypes.CollectEntriesResult;

  type FileOperations = utilsTypes.FileOperations;
}

export type { branchSummarizationTypes as default };
