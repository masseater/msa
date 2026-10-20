import { expect } from "vite-plus/test";

import sessionManagerSupport from "../../src/core/session-manager-support.ts";
import type sessionManagerTypes from "../../src/core/session-manager.types.ts";
import buildContextCases1 from "./build-context-cases-1.ts";

const { buildSessionContext } = sessionManagerSupport;

const { branchSummary, compaction, msg } = buildContextCases1;

const includesBranchSummaryInPath = () => {
  const entries: sessionManagerTypes.SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "start" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "response" }),
    msg({ id: "3", parentId: "2", role: "user", text: "abandoned path" }),
    branchSummary({ fromId: "3", id: "4", parentId: "2", summary: "Summary of abandoned work" }),
    msg({ id: "5", parentId: "4", role: "user", text: "new direction" }),
  ];
  const ctx = buildSessionContext(entries, "5");

  expect(ctx.messages).toHaveLength(4);
  expect((ctx.messages[2] as any).summary).toContain("Summary of abandoned work");
  expect((ctx.messages[3] as any).content).toBe("new direction");
};
const complexTreeWithMultipleBranchesAnd = () => {
  const entries: sessionManagerTypes.SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "start" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "r1" }),
    msg({ id: "3", parentId: "2", role: "user", text: "q2" }),
    msg({ id: "4", parentId: "3", role: "assistant", text: "r2" }),
    compaction({ firstKeptEntryId: "3", id: "5", parentId: "4", summary: "Compacted history" }),
    msg({ id: "6", parentId: "5", role: "user", text: "q3" }),
    msg({ id: "7", parentId: "6", role: "assistant", text: "r3" }),

    msg({ id: "8", parentId: "3", role: "user", text: "wrong path" }),
    msg({ id: "9", parentId: "8", role: "assistant", text: "wrong response" }),

    branchSummary({ fromId: "9", id: "10", parentId: "3", summary: "Tried wrong approach" }),
    msg({ id: "11", parentId: "10", role: "user", text: "better approach" }),
  ];

  const ctxMain = buildSessionContext(entries, "7");
  expect(ctxMain.messages).toHaveLength(5);
  expect((ctxMain.messages[0] as any).summary).toContain("Compacted history");
  expect((ctxMain.messages[1] as any).content).toBe("q2");
  expect((ctxMain.messages[2] as any).content[0].text).toBe("r2");
  expect((ctxMain.messages[3] as any).content).toBe("q3");
  expect((ctxMain.messages[4] as any).content[0].text).toBe("r3");

  const ctxBranch = buildSessionContext(entries, "11");
  expect(ctxBranch.messages).toHaveLength(5);
  expect((ctxBranch.messages[0] as any).content).toBe("start");
  expect((ctxBranch.messages[1] as any).content[0].text).toBe("r1");
  expect((ctxBranch.messages[2] as any).content).toBe("q2");
  expect((ctxBranch.messages[3] as any).summary).toContain("Tried wrong approach");
  expect((ctxBranch.messages[4] as any).content).toBe("better approach");
};
const usesLastEntryWhenLeafidNot = () => {
  const entries: sessionManagerTypes.SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "hello" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "hi" }),
  ];
  const ctx = buildSessionContext(entries, "nonexistent");
  expect(ctx.messages).toHaveLength(2);
};
const handlesOrphanedEntriesGracefully = () => {
  const entries: sessionManagerTypes.SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "hello" }),
    msg({ id: "2", parentId: "missing", role: "assistant", text: "orphan" }),
  ];
  const ctx = buildSessionContext(entries, "2");

  expect(ctx.messages).toHaveLength(1);
};

const buildContextCases2 = {
  complexTreeWithMultipleBranchesAnd,
  handlesOrphanedEntriesGracefully,
  includesBranchSummaryInPath,
  usesLastEntryWhenLeafidNot,
};

export default buildContextCases2;
