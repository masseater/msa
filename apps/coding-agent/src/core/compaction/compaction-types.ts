import type { AgentMessage } from "@msa/agent-core";
import type { Usage } from "@msa/ai/compat";

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
  usage?: Usage | undefined;
  details?: T | undefined;
}

export interface CompactionSettings {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

export interface CutPointResult {
  firstKeptEntryIndex: number;
  turnStartIndex: number;
  isSplitTurn: boolean;
}

export interface CompactionPreparation {
  firstKeptEntryId: string;
  messagesToSummarize: AgentMessage[];
  turnPrefixMessages: AgentMessage[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string | undefined;
  fileOps: FileOperations;
  settings: CompactionSettings;
}
