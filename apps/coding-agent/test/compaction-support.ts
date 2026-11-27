import type agentTypes from "@msa/agent-core/index.types";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";

import type sessionManagerTypes from "../src/core/session-manager.types.ts";

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

type EntryBase = Readonly<{ id: string; parentId: string | null; timestamp: string }>;

function appendEntry<Entry extends sessionManagerTypes.SessionEntry>(
  build: (base: EntryBase) => Entry,
): Entry {
  const id = `test-id-${entryCounter++}`;
  const entry = build({ id, parentId: lastId, timestamp: currentDate().toISOString() });
  lastId = id;
  return entry;
}

function createMessageEntry(
  message: agentTypes.AgentMessage,
): sessionManagerTypes.SessionMessageEntry {
  return appendEntry((base) => ({ ...base, message, type: "message" as const }));
}

function createCustomMessageEntry(content: string): sessionManagerTypes.CustomMessageEntry {
  return appendEntry((base) => ({
    ...base,
    content,
    customType: "test",
    display: true,
    type: "custom_message" as const,
  }));
}

function createCompactionEntry(
  summary: string,
  firstKeptEntryId: string,
): sessionManagerTypes.CompactionEntry {
  return appendEntry((base) => ({
    ...base,
    firstKeptEntryId,
    summary,
    tokensBefore: 10000,
    type: "compaction" as const,
  }));
}

function createModelChangeEntry(
  provider: string,
  modelId: string,
): sessionManagerTypes.ModelChangeEntry {
  return appendEntry((base) => ({ ...base, modelId, provider, type: "model_change" as const }));
}

function createThinkingLevelEntry(
  thinkingLevel: string,
): sessionManagerTypes.ThinkingLevelChangeEntry {
  return appendEntry((base) => ({
    ...base,
    thinkingLevel,
    type: "thinking_level_change" as const,
  }));
}

const compactionSupport = {
  createAssistantMessage,
  createCompactionEntry,
  createCustomMessageEntry,
  createMessageEntry,
  createMockUsage,
  createModelChangeEntry,
  createThinkingLevelEntry,
  createUserMessage,
  resetEntryCounter,
};

export default compactionSupport;
