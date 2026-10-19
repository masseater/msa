import type { AgentMessage } from "@msa/agent-core";
import type { AssistantMessage, Usage } from "@msa/ai/compat";
import { currentDate, currentTimeMillis } from "@msa/testing";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { DEFAULT_COMPACTION_SETTINGS, prepareCompaction } from "../src/core/compaction/index.ts";
import { type SessionMessageEntry } from "../src/core/session-manager.ts";

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

describe("prepareCompaction", () => {
  it("does not treat system messages as conversation history", () => {
    const system = createMessageEntry({
      role: "system",
      content: "",
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
  });
});
