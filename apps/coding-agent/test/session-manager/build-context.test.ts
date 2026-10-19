import { describe, expect, it } from "vite-plus/test";

import { buildSessionContext, type SessionEntry } from "../../src/core/session-manager.ts";
import {
  buildcontextentriesReturnsCompactionAwareEntriesIncluding,
  complexTreeWithMultipleBranchesAnd,
  followsPathToSpecifiedLeaf,
  handlesCompactionKeepingFromFirstMessage,
  handlesOrphanedEntriesGracefully,
  includesBranchSummaryInPath,
  includesSummaryBeforeKeptMessages,
  keepsSettingsFromTheFullPath,
  msg,
  multipleCompactionsUsesLatest,
  simpleConversation,
  tracksModelFromAssistantMessage,
  tracksModelFromModelChangeEntry,
  tracksThinkingLevelChanges,
  usesLastEntryWhenLeafidNot,
} from "./build-context-cases.ts";

describe("buildSessionContext", () => {
  describe("trivial cases", () => {
    it("empty entries returns empty context", () => {
      const ctx = buildSessionContext([]);
      expect(ctx.messages).toEqual([]);
      expect(ctx.thinkingLevel).toBe("off");
      expect(ctx.model).toBeNull();
    });
    it("single user message", () => {
      const entries: SessionEntry[] = [
        msg({ id: "1", parentId: null, role: "user", text: "hello" }),
      ];
      const ctx = buildSessionContext(entries);
      expect(ctx.messages).toHaveLength(1);
      expect(ctx.messages[0]?.role).toBe("user");
    });
    it("simple conversation", simpleConversation);
    it("tracks thinking level changes", tracksThinkingLevelChanges);
    it("tracks model from assistant message", tracksModelFromAssistantMessage);
    it("tracks model from model change entry", tracksModelFromModelChangeEntry);
  });
  describe("with compaction", () => {
    it("includes summary before kept messages", includesSummaryBeforeKeptMessages);
    it("handles compaction keeping from first message", handlesCompactionKeepingFromFirstMessage);
    it("multiple compactions uses latest", multipleCompactionsUsesLatest);
    it(
      "buildContextEntries returns compaction-aware entries including custom entries",
      buildcontextentriesReturnsCompactionAwareEntriesIncluding,
    );
    it("keeps settings from the full path after compaction", keepsSettingsFromTheFullPath);
  });
  describe("with branches", () => {
    it("follows path to specified leaf", followsPathToSpecifiedLeaf);
    it("includes branch summary in path", includesBranchSummaryInPath);
    it("complex tree with multiple branches and compaction", complexTreeWithMultipleBranchesAnd);
  });
  describe("edge cases", () => {
    it("uses last entry when leafId not found", usesLastEntryWhenLeafidNot);
    it("handles orphaned entries gracefully", handlesOrphanedEntriesGracefully);
  });
});
