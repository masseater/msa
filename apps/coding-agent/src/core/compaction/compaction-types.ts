import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";

import type { FileOperations } from "./utils.ts";

export interface CompactionDetails {
  readFiles: string[];
  modifiedFiles: string[];
}

export interface CompactionResult<T = unknown> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  estimatedTokensAfter?: number;
  usage?: compatTypes.Usage | undefined;
  details?: T | undefined;
}

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  keepRecentTokens: 20000,
  reserveTokens: 16384,
};

export interface CutPointResult {
  firstKeptEntryIndex: number;
  turnStartIndex: number;
  isSplitTurn: boolean;
}

export interface CompactionPreparation {
  firstKeptEntryId: string;
  messagesToSummarize: agentTypes.AgentMessage[];
  turnPrefixMessages: agentTypes.AgentMessage[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string | undefined;
  fileOps: FileOperations;
  settings: CompactionSettings;
}
