import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type utilsTypes from "./utils.types.ts";

declare namespace compactionTypesTypes {
  interface CompactionDetails {
    readFiles: string[];
    modifiedFiles: string[];
  }

  interface CompactionResult<T = unknown> {
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    estimatedTokensAfter?: number;
    usage?: compatTypes.Usage | undefined;
    details?: T | undefined;
  }

  interface CompactionSettings {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
  }

  interface CutPointResult {
    firstKeptEntryIndex: number;
    turnStartIndex: number;
    isSplitTurn: boolean;
  }

  interface CompactionPreparation {
    firstKeptEntryId: string;
    messagesToSummarize: agentTypes.AgentMessage[];
    turnPrefixMessages: agentTypes.AgentMessage[];
    isSplitTurn: boolean;
    tokensBefore: number;
    previousSummary?: string | undefined;
    fileOps: utilsTypes.FileOperations;
    settings: CompactionSettings;
  }
}

export type { compactionTypesTypes as default };
