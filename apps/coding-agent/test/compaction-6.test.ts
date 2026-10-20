import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import sessionManagerSupport from "../src/core/session-manager-support.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";

const { buildSessionContext } = sessionManagerSupport;

const { currentDate, currentTimeMillis } = testing;

function createMockUsage(
  input: number,
  output: number,
  cacheRead = 0,
  cacheWrite = 0,
): compatTypes.Usage {
  return {
    cacheRead,
    cacheWrite,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input,
    output,
    totalTokens: input + output + cacheRead + cacheWrite,
  };
}

function createUserMessage(text: string): agentTypes.AgentMessage {
  return { content: text, role: "user", timestamp: currentTimeMillis() };
}

function createAssistantMessage(
  text: string,
  usage?: compatTypes.Usage,
): compatTypes.AssistantMessage {
  return {
    api: "anthropic-messages" as const,
    content: [{ text, type: "text" as const }],
    model: "claude-sonnet-4-5",
    provider: "anthropic-api",
    role: "assistant",
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    usage: usage || createMockUsage(100, 50),
  };
}

let entryCounter = 0;
let lastId: string | null = null;

function resetEntryCounter() {
  entryCounter = 0;
  lastId = null;
}

beforeEach(() => {
  resetEntryCounter();
});

function createMessageEntry(
  message: agentTypes.AgentMessage,
): sessionManagerTypes.SessionMessageEntry {
  const id = `test-id-${entryCounter++}`;
  const entry: sessionManagerTypes.SessionMessageEntry = {
    id,
    message,
    parentId: lastId,
    timestamp: currentDate().toISOString(),
    type: "message" as const,
  };
  lastId = id;
  return entry;
}

function createCompactionEntry(
  summary: string,
  firstKeptEntryId: string,
): sessionManagerTypes.CompactionEntry {
  const id = `test-id-${entryCounter++}`;
  const entry: sessionManagerTypes.CompactionEntry = {
    firstKeptEntryId,
    id,
    parentId: lastId,
    summary,
    timestamp: currentDate().toISOString(),
    tokensBefore: 10000,
    type: "compaction" as const,
  };
  lastId = id;
  return entry;
}

function createModelChangeEntry(
  provider: string,
  modelId: string,
): sessionManagerTypes.ModelChangeEntry {
  const id = `test-id-${entryCounter++}`;
  const entry: sessionManagerTypes.ModelChangeEntry = {
    id,
    modelId,
    parentId: lastId,
    provider,
    timestamp: currentDate().toISOString(),
    type: "model_change" as const,
  };
  lastId = id;
  return entry;
}

function createThinkingLevelEntry(
  thinkingLevel: string,
): sessionManagerTypes.ThinkingLevelChangeEntry {
  const id = `test-id-${entryCounter++}`;
  const entry: sessionManagerTypes.ThinkingLevelChangeEntry = {
    id,
    parentId: lastId,
    thinkingLevel,
    timestamp: currentDate().toISOString(),
    type: "thinking_level_change" as const,
  };
  lastId = id;
  return entry;
}

const shouldLoadAllMessagesWhenNoCompaction = () => {
  const entries: sessionManagerTypes.SessionEntry[] = [
    createMessageEntry(createUserMessage("1")),
    createMessageEntry(createAssistantMessage("a")),
    createMessageEntry(createUserMessage("2")),
    createMessageEntry(createAssistantMessage("b")),
  ];

  const loaded = buildSessionContext(entries);
  expect(loaded.messages.length).toBe(4);
  expect(loaded.thinkingLevel).toBe("off");
  expect(loaded.model).toEqual({ modelId: "claude-sonnet-4-5", provider: "anthropic-api" });
};

const shouldHandleSingleCompaction = () => {
  const u1 = createMessageEntry(createUserMessage("1"));
  const a1 = createMessageEntry(createAssistantMessage("a"));
  const u2 = createMessageEntry(createUserMessage("2"));
  const a2 = createMessageEntry(createAssistantMessage("b"));
  const compaction = createCompactionEntry("Summary of 1,a,2,b", u2.id);
  const u3 = createMessageEntry(createUserMessage("3"));
  const a3 = createMessageEntry(createAssistantMessage("c"));

  const entries: sessionManagerTypes.SessionEntry[] = [u1, a1, u2, a2, compaction, u3, a3];

  const loaded = buildSessionContext(entries);

  expect(loaded.messages.length).toBe(5);
  expect(loaded.messages[0]?.role).toBe("compactionSummary");
  expect((loaded.messages[0] as any).summary).toContain("Summary of 1,a,2,b");
};

const shouldHandleMultipleCompactionsOnlyLatestMatters = () => {
  const u1 = createMessageEntry(createUserMessage("1"));
  const a1 = createMessageEntry(createAssistantMessage("a"));
  const compact1 = createCompactionEntry("First summary", u1.id);

  const u2 = createMessageEntry(createUserMessage("2"));
  const b = createMessageEntry(createAssistantMessage("b"));
  const u3 = createMessageEntry(createUserMessage("3"));
  const c = createMessageEntry(createAssistantMessage("c"));
  const compact2 = createCompactionEntry("Second summary", u3.id);

  const u4 = createMessageEntry(createUserMessage("4"));
  const d = createMessageEntry(createAssistantMessage("d"));

  const entries: sessionManagerTypes.SessionEntry[] = [
    u1,
    a1,
    compact1,
    u2,
    b,
    u3,
    c,
    compact2,
    u4,
    d,
  ];

  const loaded = buildSessionContext(entries);

  expect(loaded.messages.length).toBe(5);
  expect((loaded.messages[0] as any).summary).toContain("Second summary");
};

const shouldKeepAllMessagesWhenFirstkeptentryidIs = () => {
  const u1 = createMessageEntry(createUserMessage("1"));
  const a1 = createMessageEntry(createAssistantMessage("a"));
  const compact1 = createCompactionEntry("First summary", u1.id);
  const u2 = createMessageEntry(createUserMessage("2"));
  const b = createMessageEntry(createAssistantMessage("b"));

  const entries: sessionManagerTypes.SessionEntry[] = [u1, a1, compact1, u2, b];

  const loaded = buildSessionContext(entries);

  expect(loaded.messages.length).toBe(5);
};

const shouldTrackModelAndThinkingLevelChanges = () => {
  const entries: sessionManagerTypes.SessionEntry[] = [
    createMessageEntry(createUserMessage("1")),
    createModelChangeEntry("openai", "gpt-4"),
    createMessageEntry(createAssistantMessage("a")),
    createThinkingLevelEntry("high"),
  ];

  const loaded = buildSessionContext(entries);

  expect(loaded.model).toEqual({ modelId: "claude-sonnet-4-5", provider: "anthropic-api" });
  expect(loaded.thinkingLevel).toBe("high");
};

describe("buildSessionContext", () => {
  it("should load all messages when no compaction", shouldLoadAllMessagesWhenNoCompaction);
  it("should handle single compaction", shouldHandleSingleCompaction);
  it(
    "should handle multiple compactions (only latest matters)",
    shouldHandleMultipleCompactionsOnlyLatestMatters,
  );
  it(
    "should keep all messages when firstKeptEntryId is first entry",
    shouldKeepAllMessagesWhenFirstkeptentryidIs,
  );
  it("should track model and thinking level changes", shouldTrackModelAndThinkingLevelChanges);
});
