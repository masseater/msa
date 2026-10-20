import { expect } from "vite-plus/test";

import {
  type BranchSummaryEntry,
  type CompactionEntry,
  type CustomEntry,
  type ModelChangeEntry,
  type SessionEntry,
  type SessionMessageEntry,
  type ThinkingLevelChangeEntry,
  buildContextEntries,
  buildSessionContext,
} from "../../src/core/session-manager.ts";

const msg = (entry: {
  id: string;
  parentId: string | null;
  role: "user" | "assistant";
  text: string;
}): SessionMessageEntry => {
  const { id, parentId, role, text } = entry;
  const base = { id, parentId, timestamp: "2025-01-01T00:00:00Z", type: "message" as const };
  if (role === "user") {
    return { ...base, message: { content: text, role, timestamp: 1 } };
  }
  return {
    ...base,
    message: {
      api: "anthropic-messages",
      content: [{ text, type: "text" }],
      model: "claude-test",
      provider: "anthropic",
      role,
      stopReason: "stop",
      timestamp: 1,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 1,
        output: 1,
        totalTokens: 2,
      },
    },
  };
};
const compaction = (entry: {
  id: string;
  parentId: string | null;
  summary: string;
  firstKeptEntryId: string;
}): CompactionEntry => {
  const { id, parentId, summary, firstKeptEntryId } = entry;
  return {
    firstKeptEntryId,
    id,
    parentId,
    summary,
    timestamp: "2025-01-01T00:00:00Z",
    tokensBefore: 1000,
    type: "compaction",
  };
};
const branchSummary = (entry: {
  id: string;
  parentId: string | null;
  summary: string;
  fromId: string;
}): BranchSummaryEntry => {
  const { id, parentId, summary, fromId } = entry;
  return {
    fromId,
    id,
    parentId,
    summary,
    timestamp: "2025-01-01T00:00:00Z",
    type: "branch_summary",
  };
};
const custom = (entry: {
  id: string;
  parentId: string | null;
  customType: string;
  data?: unknown;
}): CustomEntry => {
  const { id, parentId, customType, data } = entry;
  return { customType, data, id, parentId, timestamp: "2025-01-01T00:00:00Z", type: "custom" };
};
const thinkingLevel = (entry: {
  id: string;
  parentId: string | null;
  level: string;
}): ThinkingLevelChangeEntry => {
  const { id, parentId, level } = entry;
  return {
    id,
    parentId,
    thinkingLevel: level,
    timestamp: "2025-01-01T00:00:00Z",
    type: "thinking_level_change",
  };
};
const modelChange = (entry: {
  id: string;
  parentId: string | null;
  provider: string;
  modelId: string;
}): ModelChangeEntry => {
  const { id, parentId, provider, modelId } = entry;
  return {
    id,
    modelId,
    parentId,
    provider,
    timestamp: "2025-01-01T00:00:00Z",
    type: "model_change",
  };
};
const simpleConversation = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "hello" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "hi there" }),
    msg({ id: "3", parentId: "2", role: "user", text: "how are you" }),
    msg({ id: "4", parentId: "3", role: "assistant", text: "great" }),
  ];
  const ctx = buildSessionContext(entries);
  expect(ctx.messages).toHaveLength(4);
  expect(ctx.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
};
const tracksThinkingLevelChanges = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "hello" }),
    thinkingLevel({ id: "2", level: "high", parentId: "1" }),
    msg({ id: "3", parentId: "2", role: "assistant", text: "thinking hard" }),
  ];
  const ctx = buildSessionContext(entries);
  expect(ctx.thinkingLevel).toBe("high");
  expect(ctx.messages).toHaveLength(2);
};
const tracksModelFromAssistantMessage = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "hello" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "hi" }),
  ];
  const ctx = buildSessionContext(entries);
  expect(ctx.model).toEqual({ modelId: "claude-test", provider: "anthropic" });
};
const tracksModelFromModelChangeEntry = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "hello" }),
    modelChange({ id: "2", modelId: "gpt-4", parentId: "1", provider: "openai" }),
    msg({ id: "3", parentId: "2", role: "assistant", text: "hi" }),
  ];
  const ctx = buildSessionContext(entries);

  expect(ctx.model).toEqual({ modelId: "claude-test", provider: "anthropic" });
};
const includesSummaryBeforeKeptMessages = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "first" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "response1" }),
    msg({ id: "3", parentId: "2", role: "user", text: "second" }),
    msg({ id: "4", parentId: "3", role: "assistant", text: "response2" }),
    compaction({
      firstKeptEntryId: "3",
      id: "5",
      parentId: "4",
      summary: "Summary of first two turns",
    }),
    msg({ id: "6", parentId: "5", role: "user", text: "third" }),
    msg({ id: "7", parentId: "6", role: "assistant", text: "response3" }),
  ];
  const ctx = buildSessionContext(entries);

  expect(ctx.messages).toHaveLength(5);
  expect((ctx.messages[0] as any).summary).toContain("Summary of first two turns");
  expect((ctx.messages[1] as any).content).toBe("second");
  expect((ctx.messages[2] as any).content[0].text).toBe("response2");
  expect((ctx.messages[3] as any).content).toBe("third");
  expect((ctx.messages[4] as any).content[0].text).toBe("response3");
};
const handlesCompactionKeepingFromFirstMessage = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "first" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "response" }),
    compaction({ firstKeptEntryId: "1", id: "3", parentId: "2", summary: "Empty summary" }),
    msg({ id: "4", parentId: "3", role: "user", text: "second" }),
  ];
  const ctx = buildSessionContext(entries);

  expect(ctx.messages).toHaveLength(4);
  expect((ctx.messages[0] as any).summary).toContain("Empty summary");
};
const multipleCompactionsUsesLatest = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "a" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "b" }),
    compaction({ firstKeptEntryId: "1", id: "3", parentId: "2", summary: "First summary" }),
    msg({ id: "4", parentId: "3", role: "user", text: "c" }),
    msg({ id: "5", parentId: "4", role: "assistant", text: "d" }),
    compaction({ firstKeptEntryId: "4", id: "6", parentId: "5", summary: "Second summary" }),
    msg({ id: "7", parentId: "6", role: "user", text: "e" }),
  ];
  const ctx = buildSessionContext(entries);

  expect(ctx.messages).toHaveLength(4);
  expect((ctx.messages[0] as any).summary).toContain("Second summary");
};
const buildcontextentriesReturnsCompactionAwareEntriesIncluding = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "first" }),
    custom({ customType: "old-state", data: { hidden: true }, id: "2", parentId: "1" }),
    msg({ id: "3", parentId: "2", role: "assistant", text: "response1" }),
    custom({ customType: "kept-card", data: { title: "Kept" }, id: "4", parentId: "3" }),
    msg({ id: "5", parentId: "4", role: "user", text: "second" }),
    compaction({ firstKeptEntryId: "4", id: "6", parentId: "5", summary: "Summary" }),
    custom({ customType: "after-card", data: { title: "After" }, id: "7", parentId: "6" }),
    msg({ id: "8", parentId: "7", role: "assistant", text: "response2" }),
  ];

  expect(buildContextEntries(entries).map((entry) => entry.id)).toEqual(["6", "4", "5", "7", "8"]);
  const ctx = buildSessionContext(entries);
  expect(ctx.messages.map((message) => message.role)).toEqual([
    "compactionSummary",
    "user",
    "assistant",
  ]);
};
const keepsSettingsFromTheFullPath = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "first" }),
    thinkingLevel({ id: "2", level: "high", parentId: "1" }),
    msg({ id: "3", parentId: "2", role: "assistant", text: "response1" }),
    msg({ id: "4", parentId: "3", role: "user", text: "second" }),
    compaction({ firstKeptEntryId: "4", id: "5", parentId: "4", summary: "Summary" }),
  ];

  const ctx = buildSessionContext(entries);
  expect(ctx.thinkingLevel).toBe("high");
  expect(ctx.messages.map((message) => message.role)).toEqual(["compactionSummary", "user"]);
};
const followsPathToSpecifiedLeaf = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "start" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "response" }),
    msg({ id: "3", parentId: "2", role: "user", text: "branch A" }),
    msg({ id: "4", parentId: "2", role: "user", text: "branch B" }),
  ];

  const ctxA = buildSessionContext(entries, "3");
  expect(ctxA.messages).toHaveLength(3);
  expect((ctxA.messages[2] as any).content).toBe("branch A");

  const ctxB = buildSessionContext(entries, "4");
  expect(ctxB.messages).toHaveLength(3);
  expect((ctxB.messages[2] as any).content).toBe("branch B");
};

const buildContextCases1 = {
  branchSummary,
  buildcontextentriesReturnsCompactionAwareEntriesIncluding,
  compaction,
  custom,
  followsPathToSpecifiedLeaf,
  handlesCompactionKeepingFromFirstMessage,
  includesSummaryBeforeKeptMessages,
  keepsSettingsFromTheFullPath,
  modelChange,
  msg,
  multipleCompactionsUsesLatest,
  simpleConversation,
  thinkingLevel,
  tracksModelFromAssistantMessage,
  tracksModelFromModelChangeEntry,
  tracksThinkingLevelChanges,
};

export default buildContextCases1;
