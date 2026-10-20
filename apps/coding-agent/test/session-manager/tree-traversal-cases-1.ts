import { expect } from "vite-plus/test";

import SessionManager from "../../src/core/session-manager.ts";
import type sessionManagerTypes from "../../src/core/session-manager.types.ts";
import utilities from "../utilities.ts";
const { assistantMsg, userMsg } = utilities;

const appendmessageCreatesEntryWithCorrectParentid = () => {
  const session = SessionManager.inMemory();

  const id1 = session.appendMessage(userMsg("first"));
  const id2 = session.appendMessage(assistantMsg("second"));
  const id3 = session.appendMessage(userMsg("third"));

  const entries = session.getEntries();
  expect(entries).toHaveLength(3);

  expect(entries[0]?.id).toBe(id1);
  expect(entries[0]?.parentId).toBeNull();
  expect(entries[0]?.type).toBe("message");

  expect(entries[1]?.id).toBe(id2);
  expect(entries[1]?.parentId).toBe(id1);

  expect(entries[2]?.id).toBe(id3);
  expect(entries[2]?.parentId).toBe(id2);
};
const appendthinkinglevelchangeIntegratesIntoTree = () => {
  const session = SessionManager.inMemory();

  const msgId = session.appendMessage(userMsg("hello"));
  const thinkingId = session.appendThinkingLevelChange("high");
  session.appendMessage(assistantMsg("response"));

  const entries = session.getEntries();
  expect(entries).toHaveLength(3);

  const thinkingEntry = entries.find((e) => e.type === "thinking_level_change");
  expect(thinkingEntry).toBeDefined();
  expect(thinkingEntry!.id).toBe(thinkingId);
  expect(thinkingEntry!.parentId).toBe(msgId);

  expect(entries[2]?.parentId).toBe(thinkingId);
};
const appendmodelchangeIntegratesIntoTree = () => {
  const session = SessionManager.inMemory();

  const msgId = session.appendMessage(userMsg("hello"));
  const modelId = session.appendModelChange("openai", "gpt-4");
  session.appendMessage(assistantMsg("response"));

  const entries = session.getEntries();
  const modelEntry = entries.find((e) => e.type === "model_change");
  expect(modelEntry).toBeDefined();
  expect(modelEntry?.id).toBe(modelId);
  expect(modelEntry?.parentId).toBe(msgId);
  if (modelEntry?.type === "model_change") {
    expect(modelEntry.provider).toBe("openai");
    expect(modelEntry.modelId).toBe("gpt-4");
  }

  expect(entries[2]?.parentId).toBe(modelId);
};
const appendcompactionIntegratesIntoTree = () => {
  const session = SessionManager.inMemory();

  const id1 = session.appendMessage(userMsg("1"));
  const id2 = session.appendMessage(assistantMsg("2"));
  const usage = {
    cacheRead: 30,
    cacheWrite: 40,
    cost: { cacheRead: 0.3, cacheWrite: 0.4, input: 0.1, output: 0.2, total: 1 },
    input: 10,
    output: 20,
    totalTokens: 100,
  };
  const compactionId = session.appendCompaction("summary", id1, 1000, undefined, false, usage);
  session.appendMessage(userMsg("3"));

  const entries = session.getEntries();
  const compactionEntry = entries.find((e) => e.type === "compaction");
  expect(compactionEntry).toBeDefined();
  expect(compactionEntry?.id).toBe(compactionId);
  expect(compactionEntry?.parentId).toBe(id2);
  if (compactionEntry?.type === "compaction") {
    expect(compactionEntry.summary).toBe("summary");
    expect(compactionEntry.firstKeptEntryId).toBe(id1);
    expect(compactionEntry.tokensBefore).toBe(1000);
    expect(compactionEntry.usage).toEqual(usage);
  }

  expect(entries[3]?.parentId).toBe(compactionId);
};
const appendcustomentryIntegratesIntoTree = () => {
  const session = SessionManager.inMemory();

  const msgId = session.appendMessage(userMsg("hello"));
  const customId = session.appendCustomEntry("my_data", { key: "value" });
  session.appendMessage(assistantMsg("response"));

  const entries = session.getEntries();
  const customEntry = entries.find((e) => e.type === "custom") as sessionManagerTypes.CustomEntry;
  expect(customEntry).toBeDefined();
  expect(customEntry.id).toBe(customId);
  expect(customEntry.parentId).toBe(msgId);
  expect(customEntry.customType).toBe("my_data");
  expect(customEntry.data).toEqual({ key: "value" });

  expect(entries[2]?.parentId).toBe(customId);
};
const leafPointerAdvancesAfterEachAppend = () => {
  const session = SessionManager.inMemory();

  expect(session.getLeafId()).toBeNull();

  const id1 = session.appendMessage(userMsg("1"));
  expect(session.getLeafId()).toBe(id1);

  const id2 = session.appendMessage(assistantMsg("2"));
  expect(session.getLeafId()).toBe(id2);

  const id3 = session.appendThinkingLevelChange("high");
  expect(session.getLeafId()).toBe(id3);
};
const returnsSingleEntryPath = () => {
  const session = SessionManager.inMemory();
  const id = session.appendMessage(userMsg("hello"));

  const path = session.getBranch();
  expect(path).toHaveLength(1);
  expect(path[0]?.id).toBe(id);
};
const returnsFullPathFromRootTo = () => {
  const session = SessionManager.inMemory();

  const id1 = session.appendMessage(userMsg("1"));
  const id2 = session.appendMessage(assistantMsg("2"));
  const id3 = session.appendThinkingLevelChange("high");
  const id4 = session.appendMessage(userMsg("3"));

  const path = session.getBranch();
  expect(path).toHaveLength(4);
  expect(path.map((e) => e.id)).toEqual([id1, id2, id3, id4]);
};
const returnsPathFromSpecifiedEntryTo = () => {
  const session = SessionManager.inMemory();

  const id1 = session.appendMessage(userMsg("1"));
  const id2 = session.appendMessage(assistantMsg("2"));
  session.appendMessage(userMsg("3"));
  session.appendMessage(assistantMsg("4"));

  const path = session.getBranch(id2);
  expect(path).toHaveLength(2);
  expect(path.map((e) => e.id)).toEqual([id1, id2]);
};
const returnsSingleRootForLinearSession = () => {
  const session = SessionManager.inMemory();

  const id1 = session.appendMessage(userMsg("1"));
  const id2 = session.appendMessage(assistantMsg("2"));
  const id3 = session.appendMessage(userMsg("3"));

  const tree = session.getTree();
  expect(tree).toHaveLength(1);

  const root = tree[0];
  if (root === undefined) throw new Error("expected a root node");
  expect(root.entry.id).toBe(id1);
  expect(root.children).toHaveLength(1);
  expect(root.children[0]?.entry.id).toBe(id2);
  expect(root.children[0]?.children).toHaveLength(1);
  expect(root.children[0]?.children[0]?.entry.id).toBe(id3);
  expect(root.children[0]?.children[0]?.children).toHaveLength(0);
};
const returnsTreeWithBranchesAfterBranch = () => {
  const session = SessionManager.inMemory();

  const id1 = session.appendMessage(userMsg("1"));
  const id2 = session.appendMessage(assistantMsg("2"));
  const id3 = session.appendMessage(userMsg("3"));

  session.branch(id2);
  const id4 = session.appendMessage(userMsg("4-branch"));

  const tree = session.getTree();
  expect(tree).toHaveLength(1);

  const root = tree[0];
  if (root === undefined) throw new Error("expected a root node");
  expect(root.entry.id).toBe(id1);
  expect(root.children).toHaveLength(1);

  const node2 = root.children[0];
  if (node2 === undefined) throw new Error("expected node 2");
  expect(node2.entry.id).toBe(id2);
  expect(node2.children).toHaveLength(2);

  const childIds = node2.children.map((c) => c.entry.id).sort();
  expect(childIds).toEqual([id3, id4].sort());
};
const handlesMultipleBranchesAtSamePoint = () => {
  const session = SessionManager.inMemory();

  session.appendMessage(userMsg("root"));
  const id2 = session.appendMessage(assistantMsg("response"));

  session.branch(id2);
  const idA = session.appendMessage(userMsg("branch-A"));

  session.branch(id2);
  const idB = session.appendMessage(userMsg("branch-B"));

  session.branch(id2);
  const idC = session.appendMessage(userMsg("branch-C"));

  const tree = session.getTree();
  const node2 = tree[0]?.children[0];
  if (node2 === undefined) throw new Error("expected node 2");
  expect(node2.entry.id).toBe(id2);
  expect(node2.children).toHaveLength(3);

  const branchIds = node2.children.map((c) => c.entry.id).sort();
  expect(branchIds).toEqual([idA, idB, idC].sort());
};

const treeTraversalCases1 = {
  appendcompactionIntegratesIntoTree,
  appendcustomentryIntegratesIntoTree,
  appendmessageCreatesEntryWithCorrectParentid,
  appendmodelchangeIntegratesIntoTree,
  appendthinkinglevelchangeIntegratesIntoTree,
  handlesMultipleBranchesAtSamePoint,
  leafPointerAdvancesAfterEachAppend,
  returnsFullPathFromRootTo,
  returnsPathFromSpecifiedEntryTo,
  returnsSingleEntryPath,
  returnsSingleRootForLinearSession,
  returnsTreeWithBranchesAfterBranch,
};

export default treeTraversalCases1;
