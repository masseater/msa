import branchSummarization from "./branch-summarization.ts";
import compactionModule from "./compaction.ts";
import utils from "./utils.ts";

const compaction = {
  DEFAULT_COMPACTION_SETTINGS: compactionModule.DEFAULT_COMPACTION_SETTINGS,
  SUMMARIZATION_SYSTEM_PROMPT: utils.SUMMARIZATION_SYSTEM_PROMPT,
  calculateContextTokens: compactionModule.calculateContextTokens,
  collectEntriesForBranchSummary: branchSummarization.collectEntriesForBranchSummary,
  compact: compactionModule.compact,
  completeSummarization: compactionModule.completeSummarization,
  computeFileLists: utils.computeFileLists,
  createFileOps: utils.createFileOps,
  estimateContextTokens: compactionModule.estimateContextTokens,
  estimateProjectedContextTokens: compactionModule.estimateProjectedContextTokens,
  estimateTokens: compactionModule.estimateTokens,
  extractFileOpsFromMessage: utils.extractFileOpsFromMessage,
  findCutPoint: compactionModule.findCutPoint,
  findTurnStartIndex: compactionModule.findTurnStartIndex,
  formatFileOperations: utils.formatFileOperations,
  generateBranchSummary: branchSummarization.generateBranchSummary,
  generateSummary: compactionModule.generateSummary,
  generateSummaryWithUsage: compactionModule.generateSummaryWithUsage,
  getLastAssistantUsage: compactionModule.getLastAssistantUsage,
  getSummarizationFailure: compactionModule.getSummarizationFailure,
  prepareBranchEntries: branchSummarization.prepareBranchEntries,
  prepareCompaction: compactionModule.prepareCompaction,
  serializeConversation: utils.serializeConversation,
  shouldCompact: compactionModule.shouldCompact,
};

export default compaction;
