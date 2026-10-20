import type { AgentMessage } from "@msa/agent-core";
import type { AssistantMessage, Usage } from "@msa/ai/compat";
import testing from "@msa/testing";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { getLastAssistantUsage } from "../src/core/compaction/index.ts";
import { type SessionEntry, type SessionMessageEntry } from "../src/core/session-manager.ts";

const { currentDate, currentTimeMillis } = testing;

function createMockUsage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
  return {
    cacheRead,
    cacheWrite,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input,
    output,
    totalTokens: input + output + cacheRead + cacheWrite,
  };
}

function createUserMessage(text: string): AgentMessage {
  return { content: text, role: "user", timestamp: currentTimeMillis() };
}

function createAssistantMessage(text: string, usage?: Usage): AssistantMessage {
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

function createMessageEntry(message: AgentMessage): SessionMessageEntry {
  const id = `test-id-${entryCounter++}`;
  const entry: SessionMessageEntry = {
    id,
    message,
    parentId: lastId,
    timestamp: currentDate().toISOString(),
    type: "message" as const,
  };
  lastId = id;
  return entry;
}

const shouldFindTheLastNonAbortedAssistant = () => {
  const entries: SessionEntry[] = [
    createMessageEntry(createUserMessage("Hello")),
    createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50))),
    createMessageEntry(createUserMessage("How are you?")),
    createMessageEntry(createAssistantMessage("Good", createMockUsage(200, 100))),
  ];

  const usage = getLastAssistantUsage(entries);
  expect(usage).not.toBeNull();
  expect(usage!.input).toBe(200);
};

const shouldSkipAbortedMessages = () => {
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
};

const shouldSkipAllZeroAssistantUsage = () => {
  const entries: SessionEntry[] = [
    createMessageEntry(createUserMessage("Hello")),
    createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50))),
    createMessageEntry(createUserMessage("continue")),
    createMessageEntry(createAssistantMessage("Partial", createMockUsage(0, 0))),
  ];

  const usage = getLastAssistantUsage(entries);
  expect(usage).not.toBeNull();
  expect(usage!.input).toBe(100);
};

const shouldReturnUndefinedIfNoAssistantMessages = () => {
  const entries: SessionEntry[] = [createMessageEntry(createUserMessage("Hello"))];
  expect(getLastAssistantUsage(entries)).toBeUndefined();
};

describe("getLastAssistantUsage", () => {
  it(
    "should find the last non-aborted assistant message usage",
    shouldFindTheLastNonAbortedAssistant,
  );
  it("should skip aborted messages", shouldSkipAbortedMessages);
  it("should skip all-zero assistant usage", shouldSkipAllZeroAssistantUsage);
  it(
    "should return undefined if no assistant messages",
    shouldReturnUndefinedIfNoAssistantMessages,
  );
});
