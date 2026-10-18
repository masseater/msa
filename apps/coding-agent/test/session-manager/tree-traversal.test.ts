import { describe, expect, it } from "vite-plus/test";

import { SessionManager } from "../../src/core/session-manager.ts";
import { userMsg } from "../utilities.ts";
import {
  appendcompactionIntegratesIntoTree,
  appendcustomentryIntegratesIntoTree,
  appendmessageCreatesEntryWithCorrectParentid,
  appendmodelchangeIntegratesIntoTree,
  appendthinkinglevelchangeIntegratesIntoTree,
  createsNewSessionWithPathTo,
  doesNotDuplicateEntriesWhenForking,
  extractsCorrectPathFromBranchedTree,
  handlesDeepBranching,
  handlesMultipleBranchesAtSamePoint,
  insertsBranchSummaryWithTheSource,
  leafPointerAdvancesAfterEachAppend,
  movesLeafPointerToSpecifiedEntry,
  newAppendsBecomeChildrenOfBranch,
  preservesToolAndSummaryUsageAcross,
  returnsCurrentLeafEntry,
  returnsEntryById,
  returnsFullPathFromRootTo,
  returnsMessagesFromCurrentBranchOnly,
  returnsPathFromSpecifiedEntryTo,
  returnsSingleEntryPath,
  returnsSingleRootForLinearSession,
  returnsTreeWithBranchesAfterBranch,
  throwsForNonExistentEntry,
  throwsForNonExistentEntry2,
  writesFileImmediatelyWhenForkingAt,
} from "./tree-traversal-cases.ts";

describe("SessionManager append and tree traversal", () => {
  describe("append operations", () => {
    it(
      "appendMessage creates entry with correct parentId chain",
      appendmessageCreatesEntryWithCorrectParentid,
    );
    it(
      "appendThinkingLevelChange integrates into tree",
      appendthinkinglevelchangeIntegratesIntoTree,
    );
    it("appendModelChange integrates into tree", appendmodelchangeIntegratesIntoTree);
    it("appendCompaction integrates into tree", appendcompactionIntegratesIntoTree);
    it("appendCustomEntry integrates into tree", appendcustomentryIntegratesIntoTree);
    it("leaf pointer advances after each append", leafPointerAdvancesAfterEachAppend);
  });
  describe("getPath", () => {
    it("returns empty array for empty session", () => {
      const session = SessionManager.inMemory();
      expect(session.getBranch()).toEqual([]);
    });
    it("returns single entry path", returnsSingleEntryPath);
    it("returns full path from root to leaf", returnsFullPathFromRootTo);
    it("returns path from specified entry to root", returnsPathFromSpecifiedEntryTo);
  });
  describe("getTree", () => {
    it("returns empty array for empty session", () => {
      const session = SessionManager.inMemory();
      expect(session.getTree()).toEqual([]);
    });
    it("returns single root for linear session", returnsSingleRootForLinearSession);
    it("returns tree with branches after branch", returnsTreeWithBranchesAfterBranch);
    it("handles multiple branches at same point", handlesMultipleBranchesAtSamePoint);
    it("handles deep branching", handlesDeepBranching);
  });
  describe("branch", () => {
    it("moves leaf pointer to specified entry", movesLeafPointerToSpecifiedEntry);
    it("throws for non-existent entry", () => {
      const session = SessionManager.inMemory();
      session.appendMessage(userMsg("hello"));

      expect(() => session.branch("nonexistent")).toThrow("Entry nonexistent not found");
    });
    it("new appends become children of branch point", newAppendsBecomeChildrenOfBranch);
  });
  describe("branchWithSummary", () => {
    it(
      "inserts branch summary with the source and destination and advances leaf",
      insertsBranchSummaryWithTheSource,
    );
    it("throws for non-existent entry", throwsForNonExistentEntry);
  });
  describe("getLeafEntry", () => {
    it("returns undefined for empty session", () => {
      const session = SessionManager.inMemory();
      expect(session.getLeafEntry()).toBeUndefined();
    });
    it("returns current leaf entry", returnsCurrentLeafEntry);
  });
  describe("getEntry", () => {
    it("returns undefined for non-existent id", () => {
      const session = SessionManager.inMemory();
      expect(session.getEntry("nonexistent")).toBeUndefined();
    });
    it("returns entry by id", returnsEntryById);
  });
  describe("buildSessionContext with branches", () => {
    it("returns messages from current branch only", returnsMessagesFromCurrentBranchOnly);
  });
});
describe("createBranchedSession", () => {
  it("throws for non-existent entry", throwsForNonExistentEntry2);
  it("creates new session with path to specified leaf (in-memory)", createsNewSessionWithPathTo);
  it("extracts correct path from branched tree", extractsCorrectPathFromBranchedTree);
  it(
    "does not duplicate entries when forking from before the first user message",
    doesNotDuplicateEntriesWhenForking,
  );
  it(
    "preserves tool and summary usage across a file-backed reload",
    preservesToolAndSummaryUsageAcross,
  );
  it("writes file immediately when forking at a user message", writesFileImmediatelyWhenForkingAt);
});
