import buildContextCases1 from "./build-context-cases-1.ts";
import buildContextCases2 from "./build-context-cases-2.ts";

const buildContextCases = {
  branchSummary: buildContextCases1.branchSummary,
  buildcontextentriesReturnsCompactionAwareEntriesIncluding:
    buildContextCases1.buildcontextentriesReturnsCompactionAwareEntriesIncluding,
  compaction: buildContextCases1.compaction,
  complexTreeWithMultipleBranchesAnd: buildContextCases2.complexTreeWithMultipleBranchesAnd,
  custom: buildContextCases1.custom,
  followsPathToSpecifiedLeaf: buildContextCases1.followsPathToSpecifiedLeaf,
  handlesCompactionKeepingFromFirstMessage:
    buildContextCases1.handlesCompactionKeepingFromFirstMessage,
  handlesOrphanedEntriesGracefully: buildContextCases2.handlesOrphanedEntriesGracefully,
  includesBranchSummaryInPath: buildContextCases2.includesBranchSummaryInPath,
  includesSummaryBeforeKeptMessages: buildContextCases1.includesSummaryBeforeKeptMessages,
  keepsSettingsFromTheFullPath: buildContextCases1.keepsSettingsFromTheFullPath,
  modelChange: buildContextCases1.modelChange,
  msg: buildContextCases1.msg,
  multipleCompactionsUsesLatest: buildContextCases1.multipleCompactionsUsesLatest,
  simpleConversation: buildContextCases1.simpleConversation,
  thinkingLevel: buildContextCases1.thinkingLevel,
  tracksModelFromAssistantMessage: buildContextCases1.tracksModelFromAssistantMessage,
  tracksModelFromModelChangeEntry: buildContextCases1.tracksModelFromModelChangeEntry,
  tracksThinkingLevelChanges: buildContextCases1.tracksThinkingLevelChanges,
  usesLastEntryWhenLeafidNot: buildContextCases2.usesLastEntryWhenLeafidNot,
};

export default buildContextCases;
