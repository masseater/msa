import type { AgentMessage } from "@msa/agent-core";
import type { AssistantMessage, Usage } from "@msa/ai/compat";
import { currentDate, currentTimeMillis } from "@msa/testing";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  buildSessionContext,
  type CompactionEntry,
  type ModelChangeEntry,
  type SessionEntry,
  type SessionMessageEntry,
  type ThinkingLevelChangeEntry,
} from "../src/core/session-manager.ts";

function createMockUsage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function createUserMessage(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: currentTimeMillis() };
}

function createAssistantMessage(text: string, usage?: Usage): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text" as const, text }],
    usage: usage || createMockUsage(100, 50),
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    api: "anthropic-messages" as const,
    provider: "anthropic-api",
    model: "claude-sonnet-4-5",
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

function createMessageEntry(message: AgentMessage): SessionMessageEntry {
  const id = `test-id-${entryCounter++}`;
  const entry: SessionMessageEntry = {
    type: "message" as const,
    id,
    parentId: lastId,
    timestamp: currentDate().toISOString(),
    message,
  };
  lastId = id;
  return entry;
}

function createCompactionEntry(summary: string, firstKeptEntryId: string): CompactionEntry {
  const id = `test-id-${entryCounter++}`;
  const entry: CompactionEntry = {
    type: "compaction" as const,
    id,
    parentId: lastId,
    timestamp: currentDate().toISOString(),
    summary,
    firstKeptEntryId,
    tokensBefore: 10000,
  };
  lastId = id;
  return entry;
}

function createModelChangeEntry(provider: string, modelId: string): ModelChangeEntry {
  const id = `test-id-${entryCounter++}`;
  const entry: ModelChangeEntry = {
    type: "model_change" as const,
    id,
    parentId: lastId,
    timestamp: currentDate().toISOString(),
    provider,
    modelId,
  };
  lastId = id;
  return entry;
}

function createThinkingLevelEntry(thinkingLevel: string): ThinkingLevelChangeEntry {
  const id = `test-id-${entryCounter++}`;
  const entry: ThinkingLevelChangeEntry = {
    type: "thinking_level_change" as const,
    id,
    parentId: lastId,
    timestamp: currentDate().toISOString(),
    thinkingLevel,
  };
  lastId = id;
  return entry;
}

describe("buildSessionContext", () => {
  it("should load all messages when no compaction", () => {
    const entries: SessionEntry[] = [
      createMessageEntry(createUserMessage("1")),
      createMessageEntry(createAssistantMessage("a")),
      createMessageEntry(createUserMessage("2")),
      createMessageEntry(createAssistantMessage("b")),
    ];

    const loaded = buildSessionContext(entries);
    expect(loaded.messages.length).toBe(4);
    expect(loaded.thinkingLevel).toBe("off");
    expect(loaded.model).toEqual({ provider: "anthropic-api", modelId: "claude-sonnet-4-5" });
  });
  it("should handle single compaction", () => {
    const u1 = createMessageEntry(createUserMessage("1"));
    const a1 = createMessageEntry(createAssistantMessage("a"));
    const u2 = createMessageEntry(createUserMessage("2"));
    const a2 = createMessageEntry(createAssistantMessage("b"));
    const compaction = createCompactionEntry("Summary of 1,a,2,b", u2.id);
    const u3 = createMessageEntry(createUserMessage("3"));
    const a3 = createMessageEntry(createAssistantMessage("c"));

    const entries: SessionEntry[] = [u1, a1, u2, a2, compaction, u3, a3];

    const loaded = buildSessionContext(entries);

    expect(loaded.messages.length).toBe(5);
    expect(loaded.messages[0]?.role).toBe("compactionSummary");
    expect((loaded.messages[0] as any).summary).toContain("Summary of 1,a,2,b");
  });
  it("should handle multiple compactions (only latest matters)", () => {
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

    const entries: SessionEntry[] = [u1, a1, compact1, u2, b, u3, c, compact2, u4, d];

    const loaded = buildSessionContext(entries);

    expect(loaded.messages.length).toBe(5);
    expect((loaded.messages[0] as any).summary).toContain("Second summary");
  });
  it("should keep all messages when firstKeptEntryId is first entry", () => {
    const u1 = createMessageEntry(createUserMessage("1"));
    const a1 = createMessageEntry(createAssistantMessage("a"));
    const compact1 = createCompactionEntry("First summary", u1.id);
    const u2 = createMessageEntry(createUserMessage("2"));
    const b = createMessageEntry(createAssistantMessage("b"));

    const entries: SessionEntry[] = [u1, a1, compact1, u2, b];

    const loaded = buildSessionContext(entries);

    expect(loaded.messages.length).toBe(5);
  });
  it("should track model and thinking level changes", () => {
    const entries: SessionEntry[] = [
      createMessageEntry(createUserMessage("1")),
      createModelChangeEntry("openai", "gpt-4"),
      createMessageEntry(createAssistantMessage("a")),
      createThinkingLevelEntry("high"),
    ];

    const loaded = buildSessionContext(entries);

    expect(loaded.model).toEqual({ provider: "anthropic-api", modelId: "claude-sonnet-4-5" });
    expect(loaded.thinkingLevel).toBe("high");
  });
});
