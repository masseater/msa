import { describe, expect, it } from "vite-plus/test";

import SessionManager from "../../src/core/session-manager.ts";
import utilities from "../utilities.ts";
import treeTraversalCases from "./tree-traversal-cases.ts";
const {
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
} = treeTraversalCases;
const { userMsg } = utilities;

const returnsEmptyArrayForEmptySession = () => {
  const session = SessionManager.inMemory();
  expect(session.getBranch()).toEqual([]);
};

const returnsEmptyArrayForEmptySession2 = () => {
  const session = SessionManager.inMemory();
  expect(session.getTree()).toEqual([]);
};

const throwsForNonExistentEntry3 = () => {
  const session = SessionManager.inMemory();
  session.appendMessage(userMsg("hello"));

  expect(() => session.branch("nonexistent")).toThrow("Entry nonexistent not found");
};

const returnsUndefinedForEmptySession = () => {
  const session = SessionManager.inMemory();
  expect(session.getLeafEntry()).toBeUndefined();
};

const returnsUndefinedForNonExistentId = () => {
  const session = SessionManager.inMemory();
  expect(session.getEntry("nonexistent")).toBeUndefined();
};

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
    it("returns empty array for empty session", returnsEmptyArrayForEmptySession);
    it("returns single entry path", returnsSingleEntryPath);
    it("returns full path from root to leaf", returnsFullPathFromRootTo);
    it("returns path from specified entry to root", returnsPathFromSpecifiedEntryTo);
  });

  describe("getTree", () => {
    it("returns empty array for empty session", returnsEmptyArrayForEmptySession2);
    it("returns single root for linear session", returnsSingleRootForLinearSession);
    it("returns tree with branches after branch", returnsTreeWithBranchesAfterBranch);
    it("handles multiple branches at same point", handlesMultipleBranchesAtSamePoint);
    it("handles deep branching", handlesDeepBranching);
  });

  describe("branch", () => {
    it("moves leaf pointer to specified entry", movesLeafPointerToSpecifiedEntry);
    it("throws for non-existent entry", throwsForNonExistentEntry3);
    it("new appends become children of branch point", newAppendsBecomeChildrenOfBranch);
  });
});

describe("SessionManager append and tree traversal", () => {
  describe("branchWithSummary", () => {
    it(
      "inserts branch summary with the source and destination and advances leaf",
      insertsBranchSummaryWithTheSource,
    );
    it("throws for non-existent entry", throwsForNonExistentEntry);
  });

  describe("getLeafEntry", () => {
    it("returns undefined for empty session", returnsUndefinedForEmptySession);
    it("returns current leaf entry", returnsCurrentLeafEntry);
  });

  describe("getEntry", () => {
    it("returns undefined for non-existent id", returnsUndefinedForNonExistentId);
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
