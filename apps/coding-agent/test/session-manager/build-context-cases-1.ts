import { expect } from "vite-plus/test";

import {
  type BranchSummaryEntry,
  buildContextEntries,
  buildSessionContext,
  type CompactionEntry,
  type CustomEntry,
  type ModelChangeEntry,
  type SessionEntry,
  type SessionMessageEntry,
  type ThinkingLevelChangeEntry,
} from "../../src/core/session-manager.ts";

export const msg = (entry: {
  id: string;
  parentId: string | null;
  role: "user" | "assistant";
  text: string;
}): SessionMessageEntry => {
  const { id, parentId, role, text } = entry;
  const base = { type: "message" as const, id, parentId, timestamp: "2025-01-01T00:00:00Z" };
  if (role === "user") {
    return { ...base, message: { role, content: text, timestamp: 1 } };
  }
  return {
    ...base,
    message: {
      role,
      content: [{ type: "text", text }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-test",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 1,
    },
  };
};
export const compaction = (entry: {
  id: string;
  parentId: string | null;
  summary: string;
  firstKeptEntryId: string;
}): CompactionEntry => {
  const { id, parentId, summary, firstKeptEntryId } = entry;
  return {
    type: "compaction",
    id,
    parentId,
    timestamp: "2025-01-01T00:00:00Z",
    summary,
    firstKeptEntryId,
    tokensBefore: 1000,
  };
};
export const branchSummary = (entry: {
  id: string;
  parentId: string | null;
  summary: string;
  fromId: string;
}): BranchSummaryEntry => {
  const { id, parentId, summary, fromId } = entry;
  return {
    type: "branch_summary",
    id,
    parentId,
    timestamp: "2025-01-01T00:00:00Z",
    summary,
    fromId,
  };
};
export const custom = (entry: {
  id: string;
  parentId: string | null;
  customType: string;
  data?: unknown;
}): CustomEntry => {
  const { id, parentId, customType, data } = entry;
  return { type: "custom", id, parentId, timestamp: "2025-01-01T00:00:00Z", customType, data };
};
export const thinkingLevel = (entry: {
  id: string;
  parentId: string | null;
  level: string;
}): ThinkingLevelChangeEntry => {
  const { id, parentId, level } = entry;
  return {
    type: "thinking_level_change",
    id,
    parentId,
    timestamp: "2025-01-01T00:00:00Z",
    thinkingLevel: level,
  };
};
export const modelChange = (entry: {
  id: string;
  parentId: string | null;
  provider: string;
  modelId: string;
}): ModelChangeEntry => {
  const { id, parentId, provider, modelId } = entry;
  return {
    type: "model_change",
    id,
    parentId,
    timestamp: "2025-01-01T00:00:00Z",
    provider,
    modelId,
  };
};
export const simpleConversation = () => {
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
export const tracksThinkingLevelChanges = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "hello" }),
    thinkingLevel({ id: "2", parentId: "1", level: "high" }),
    msg({ id: "3", parentId: "2", role: "assistant", text: "thinking hard" }),
  ];
  const ctx = buildSessionContext(entries);
  expect(ctx.thinkingLevel).toBe("high");
  expect(ctx.messages).toHaveLength(2);
};
export const tracksModelFromAssistantMessage = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "hello" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "hi" }),
  ];
  const ctx = buildSessionContext(entries);
  expect(ctx.model).toEqual({ provider: "anthropic", modelId: "claude-test" });
};
export const tracksModelFromModelChangeEntry = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "hello" }),
    modelChange({ id: "2", parentId: "1", provider: "openai", modelId: "gpt-4" }),
    msg({ id: "3", parentId: "2", role: "assistant", text: "hi" }),
  ];
  const ctx = buildSessionContext(entries);

  expect(ctx.model).toEqual({ provider: "anthropic", modelId: "claude-test" });
};
export const includesSummaryBeforeKeptMessages = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "first" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "response1" }),
    msg({ id: "3", parentId: "2", role: "user", text: "second" }),
    msg({ id: "4", parentId: "3", role: "assistant", text: "response2" }),
    compaction({
      id: "5",
      parentId: "4",
      summary: "Summary of first two turns",
      firstKeptEntryId: "3",
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
export const handlesCompactionKeepingFromFirstMessage = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "first" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "response" }),
    compaction({ id: "3", parentId: "2", summary: "Empty summary", firstKeptEntryId: "1" }),
    msg({ id: "4", parentId: "3", role: "user", text: "second" }),
  ];
  const ctx = buildSessionContext(entries);

  expect(ctx.messages).toHaveLength(4);
  expect((ctx.messages[0] as any).summary).toContain("Empty summary");
};
export const multipleCompactionsUsesLatest = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "a" }),
    msg({ id: "2", parentId: "1", role: "assistant", text: "b" }),
    compaction({ id: "3", parentId: "2", summary: "First summary", firstKeptEntryId: "1" }),
    msg({ id: "4", parentId: "3", role: "user", text: "c" }),
    msg({ id: "5", parentId: "4", role: "assistant", text: "d" }),
    compaction({ id: "6", parentId: "5", summary: "Second summary", firstKeptEntryId: "4" }),
    msg({ id: "7", parentId: "6", role: "user", text: "e" }),
  ];
  const ctx = buildSessionContext(entries);

  expect(ctx.messages).toHaveLength(4);
  expect((ctx.messages[0] as any).summary).toContain("Second summary");
};
export const buildcontextentriesReturnsCompactionAwareEntriesIncluding = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "first" }),
    custom({ id: "2", parentId: "1", customType: "old-state", data: { hidden: true } }),
    msg({ id: "3", parentId: "2", role: "assistant", text: "response1" }),
    custom({ id: "4", parentId: "3", customType: "kept-card", data: { title: "Kept" } }),
    msg({ id: "5", parentId: "4", role: "user", text: "second" }),
    compaction({ id: "6", parentId: "5", summary: "Summary", firstKeptEntryId: "4" }),
    custom({ id: "7", parentId: "6", customType: "after-card", data: { title: "After" } }),
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
export const keepsSettingsFromTheFullPath = () => {
  const entries: SessionEntry[] = [
    msg({ id: "1", parentId: null, role: "user", text: "first" }),
    thinkingLevel({ id: "2", parentId: "1", level: "high" }),
    msg({ id: "3", parentId: "2", role: "assistant", text: "response1" }),
    msg({ id: "4", parentId: "3", role: "user", text: "second" }),
    compaction({ id: "5", parentId: "4", summary: "Summary", firstKeptEntryId: "4" }),
  ];

  const ctx = buildSessionContext(entries);
  expect(ctx.thinkingLevel).toBe("high");
  expect(ctx.messages.map((message) => message.role)).toEqual(["compactionSummary", "user"]);
};
export const followsPathToSpecifiedLeaf = () => {
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
