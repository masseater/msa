import { Effect } from "effect";
import { expect } from "vite-plus/test";
import { SessionManager } from "../../src/core/session-manager.ts";
import { assistantMsg, readSessionFileRoles, userMsg } from "../utilities.ts";
import { fs, runtime } from "./tree-traversal-cases-1.ts";

export const handlesDeepBranching = () => {
  const session = SessionManager.inMemory();

  session.appendMessage(userMsg("1"));
  const id2 = session.appendMessage(assistantMsg("2"));
  const id3 = session.appendMessage(userMsg("3"));
  session.appendMessage(assistantMsg("4"));

  session.branch(id2);
  const id5 = session.appendMessage(userMsg("5"));
  session.appendMessage(assistantMsg("6"));

  session.branch(id5);
  session.appendMessage(userMsg("7"));

  const tree = session.getTree();

  const node2 = tree[0]?.children[0];
  if (node2 === undefined) throw new Error("expected node 2");
  expect(node2.children).toHaveLength(2);

  const node5 = node2.children.find((c) => c.entry.id === id5)!;
  expect(node5.children).toHaveLength(2);

  const node3 = node2.children.find((c) => c.entry.id === id3)!;
  expect(node3.children).toHaveLength(1);
};
export const movesLeafPointerToSpecifiedEntry = () => {
  const session = SessionManager.inMemory();

  const id1 = session.appendMessage(userMsg("1"));
  session.appendMessage(assistantMsg("2"));
  const id3 = session.appendMessage(userMsg("3"));

  expect(session.getLeafId()).toBe(id3);

  session.branch(id1);
  expect(session.getLeafId()).toBe(id1);
};
export const newAppendsBecomeChildrenOfBranch = () => {
  const session = SessionManager.inMemory();

  const id1 = session.appendMessage(userMsg("1"));
  session.appendMessage(assistantMsg("2"));

  session.branch(id1);
  const id3 = session.appendMessage(userMsg("branched"));

  const entries = session.getEntries();
  const branchedEntry = entries.find((e) => e.id === id3)!;
  expect(branchedEntry.parentId).toBe(id1);
};
export const insertsBranchSummaryWithTheSource = () => {
  const session = SessionManager.inMemory();

  const id1 = session.appendMessage(userMsg("1"));
  session.appendMessage(assistantMsg("2"));
  const id3 = session.appendMessage(userMsg("3"));

  const usage = {
    input: 10,
    output: 20,
    cacheRead: 30,
    cacheWrite: 40,
    totalTokens: 100,
    cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
  };
  const summaryId = session.branchWithSummary(
    id1,
    "Summary of abandoned work",
    undefined,
    false,
    usage,
  );

  expect(session.getLeafId()).toBe(summaryId);

  const entries = session.getEntries();
  const summaryEntry = entries.find((e) => e.type === "branch_summary");
  expect(summaryEntry).toBeDefined();
  expect(summaryEntry?.parentId).toBe(id1);
  if (summaryEntry?.type === "branch_summary") {
    expect(summaryEntry.fromId).toBe(id3);
    expect(summaryEntry.summary).toBe("Summary of abandoned work");
    expect(summaryEntry.usage).toEqual(usage);
  }
};
export const throwsForNonExistentEntry = () => {
  const session = SessionManager.inMemory();
  session.appendMessage(userMsg("hello"));

  expect(() => session.branchWithSummary("nonexistent", "summary")).toThrow(
    "Entry nonexistent not found",
  );
};
export const returnsCurrentLeafEntry = () => {
  const session = SessionManager.inMemory();

  session.appendMessage(userMsg("1"));
  const id2 = session.appendMessage(assistantMsg("2"));

  const leaf = session.getLeafEntry();
  expect(leaf).toBeDefined();
  expect(leaf!.id).toBe(id2);
};
export const returnsEntryById = () => {
  const session = SessionManager.inMemory();

  const id1 = session.appendMessage(userMsg("first"));
  const id2 = session.appendMessage(assistantMsg("second"));

  const entry1 = session.getEntry(id1);
  expect(entry1).toBeDefined();
  expect(entry1?.type).toBe("message");
  if (entry1?.type === "message" && entry1.message.role === "user") {
    expect(entry1.message.content).toBe("first");
  }

  const entry2 = session.getEntry(id2);
  expect(entry2).toBeDefined();
  if (entry2?.type === "message" && entry2.message.role === "assistant") {
    expect((entry2.message.content as any)[0].text).toBe("second");
  }
};
export const returnsMessagesFromCurrentBranchOnly = () => {
  const session = SessionManager.inMemory();

  session.appendMessage(userMsg("msg1"));
  const id2 = session.appendMessage(assistantMsg("msg2"));
  session.appendMessage(userMsg("msg3"));

  session.branch(id2);
  session.appendMessage(assistantMsg("msg4-branch"));

  const ctx = session.buildSessionContext();
  expect(ctx.messages).toHaveLength(3);

  expect((ctx.messages[0] as any).content).toBe("msg1");
  expect((ctx.messages[1] as any).content[0].text).toBe("msg2");
  expect((ctx.messages[2] as any).content[0].text).toBe("msg4-branch");
};
export const throwsForNonExistentEntry2 = () => {
  const session = SessionManager.inMemory();
  session.appendMessage(userMsg("hello"));

  expect(() => session.createBranchedSession("nonexistent")).toThrow("Entry nonexistent not found");
};
export const createsNewSessionWithPathTo = () => {
  const session = SessionManager.inMemory();

  const id1 = session.appendMessage(userMsg("1"));
  const id2 = session.appendMessage(assistantMsg("2"));
  const id3 = session.appendMessage(userMsg("3"));
  session.appendMessage(assistantMsg("4"));

  session.branch(id3);
  session.appendMessage(userMsg("5"));

  const result = session.createBranchedSession(id2);
  expect(result).toBeUndefined();

  const entries = session.getEntries();
  expect(entries).toHaveLength(2);
  expect(entries[0]?.id).toBe(id1);
  expect(entries[1]?.id).toBe(id2);
};
export const extractsCorrectPathFromBranchedTree = () => {
  const session = SessionManager.inMemory();

  const id1 = session.appendMessage(userMsg("1"));
  const id2 = session.appendMessage(assistantMsg("2"));
  session.appendMessage(userMsg("3"));

  session.branch(id2);
  const id4 = session.appendMessage(userMsg("4"));
  const id5 = session.appendMessage(assistantMsg("5"));

  session.createBranchedSession(id5);

  const entries = session.getEntries();
  expect(entries).toHaveLength(4);
  expect(entries.map((e) => e.id)).toEqual([id1, id2, id4, id5]);
};
export const doesNotDuplicateEntriesWhenForking = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const tempDir = yield* fs.makeTempDirectory({ prefix: `session-fork-dedup-` });
      yield* fs.makeDirectory(tempDir, { recursive: true });

      try {
        const session = SessionManager.create(tempDir, tempDir);
        const modelChangeId = session.appendModelChange("anthropic", "claude-sonnet-4-5");
        session.appendMessage(userMsg("first question"));
        session.appendMessage(assistantMsg("first answer"));

        const newFile = session.createBranchedSession(modelChangeId);
        expect(newFile).toBeDefined();

        expect(yield* fs.exists(newFile!)).toBe(false);

        session.appendMessage(userMsg("new question"));
        expect(yield* fs.exists(newFile!)).toBe(true);

        session.appendCustomEntry("preset-state", { name: "plan" });
        session.appendMessage(assistantMsg("new answer"));

        expect(yield* Effect.promise(() => readSessionFileRoles(newFile!))).toEqual([
          "session",
          "model_change",
          "user",
          "custom",
          "assistant",
        ]);
      } finally {
        yield* fs.remove(tempDir, { recursive: true, force: true });
      }
    }),
  );
