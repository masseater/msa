import type { AgentMessage } from "@msa/agent-core";
import type { AssistantMessage, Usage } from "@msa/ai/compat";
import testing from "@msa/testing";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { DEFAULT_COMPACTION_SETTINGS, prepareCompaction } from "../src/core/compaction/index.ts";
import { type SessionMessageEntry } from "../src/core/session-manager.ts";

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

const doesNotTreatSystemMessagesAsConversation = () => {
  const system = createMessageEntry({
    content: "",
    role: "system",
    sections: { preamble: "current prompt" },
    timestamp: currentTimeMillis(),
  });
  const user = createMessageEntry(createUserMessage("one long turn"));
  const assistant = createMessageEntry(createAssistantMessage("assistant suffix"));
  const preparation = prepareCompaction([system, user, assistant], {
    ...DEFAULT_COMPACTION_SETTINGS,
    keepRecentTokens: 1,
  });

  expect(preparation).toBeDefined();
  expect(preparation?.firstKeptEntryId).toBe(assistant.id);
  expect(preparation?.isSplitTurn).toBe(true);
  expect(preparation?.messagesToSummarize).toEqual([]);
  expect(preparation?.turnPrefixMessages).toEqual([user.message]);
};

describe("prepareCompaction", () => {
  it(
    "does not treat system messages as conversation history",
    doesNotTreatSystemMessagesAsConversation,
  );
});
