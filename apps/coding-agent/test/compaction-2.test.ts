import type { AgentMessage } from "@msa/agent-core";
import type { AssistantMessage, Usage } from "@msa/ai/compat";
import { currentDate, currentTimeMillis } from "@msa/testing";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { getLastAssistantUsage } from "../src/core/compaction/index.ts";
import { type SessionEntry, type SessionMessageEntry } from "../src/core/session-manager.ts";

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

describe("getLastAssistantUsage", () => {
  it("should find the last non-aborted assistant message usage", () => {
    const entries: SessionEntry[] = [
      createMessageEntry(createUserMessage("Hello")),
      createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50))),
      createMessageEntry(createUserMessage("How are you?")),
      createMessageEntry(createAssistantMessage("Good", createMockUsage(200, 100))),
    ];

    const usage = getLastAssistantUsage(entries);
    expect(usage).not.toBeNull();
    expect(usage!.input).toBe(200);
  });
  it("should skip aborted messages", () => {
    const abortedMsg: AssistantMessage = {
      ...createAssistantMessage("Aborted", createMockUsage(300, 150)),
      stopReason: "aborted",
    };

    const entries: SessionEntry[] = [
      createMessageEntry(createUserMessage("Hello")),
      createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50))),
      createMessageEntry(createUserMessage("How are you?")),
      createMessageEntry(abortedMsg),
    ];

    const usage = getLastAssistantUsage(entries);
    expect(usage).not.toBeNull();
    expect(usage!.input).toBe(100);
  });
  it("should skip all-zero assistant usage", () => {
    const entries: SessionEntry[] = [
      createMessageEntry(createUserMessage("Hello")),
      createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50))),
      createMessageEntry(createUserMessage("continue")),
      createMessageEntry(createAssistantMessage("Partial", createMockUsage(0, 0))),
    ];

    const usage = getLastAssistantUsage(entries);
    expect(usage).not.toBeNull();
    expect(usage!.input).toBe(100);
  });
  it("should return undefined if no assistant messages", () => {
    const entries: SessionEntry[] = [createMessageEntry(createUserMessage("Hello"))];
    expect(getLastAssistantUsage(entries)).toBeUndefined();
  });
});
