import compactionCompact from "./compaction-compact.ts";
import compactionCut from "./compaction-cut.ts";
import compactionPrepare from "./compaction-prepare.ts";
import compactionSummary from "./compaction-summary.ts";
import compactionTokens from "./compaction-tokens.ts";
import compactionTypesModule from "./compaction-types.ts";

const compaction = {
  DEFAULT_COMPACTION_SETTINGS: compactionTypesModule.DEFAULT_COMPACTION_SETTINGS,
  calculateContextTokens: compactionTokens.calculateContextTokens,
  compact: compactionCompact.compact,
  completeSummarization: compactionSummary.completeSummarization,
  estimateContextTokens: compactionTokens.estimateContextTokens,
  estimateProjectedContextTokens: compactionTokens.estimateProjectedContextTokens,
  estimateTokens: compactionTokens.estimateTokens,
  findCutPoint: compactionCut.findCutPoint,
  findTurnStartIndex: compactionCut.findTurnStartIndex,
  generateSummary: compactionSummary.generateSummary,
  generateSummaryWithUsage: compactionSummary.generateSummaryWithUsage,
  getLastAssistantUsage: compactionTokens.getLastAssistantUsage,
  getSummarizationFailure: compactionSummary.getSummarizationFailure,
  prepareCompaction: compactionPrepare.prepareCompaction,
  shouldCompact: compactionTokens.shouldCompact,
};

export default compaction;
