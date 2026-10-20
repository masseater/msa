import type { AgentMessage } from "@msa/agent-core";
import type { AssistantMessage, Usage } from "@msa/ai/compat";
import testing from "@msa/testing";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_COMPACTION_SETTINGS,
  findCutPoint,
  prepareCompaction,
} from "../src/core/compaction/index.ts";
import {
  type CustomMessageEntry,
  type SessionEntry,
  type SessionMessageEntry,
} from "../src/core/session-manager.ts";

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

function createCustomMessageEntry(content: string): CustomMessageEntry {
  const id = `test-id-${entryCounter++}`;
  const entry: CustomMessageEntry = {
    content,
    customType: "test",
    display: true,
    id,
    parentId: lastId,
    timestamp: currentDate().toISOString(),
    type: "custom_message" as const,
  };
  lastId = id;
  return entry;
}

const shouldFindCutPointBasedOnActual = () => {
  const entries: SessionEntry[] = [];
  for (let i = 0; i < 10; i++) {
    entries.push(createMessageEntry(createUserMessage(`User ${i}`)));
    entries.push(
      createMessageEntry(
        createAssistantMessage(`Assistant ${i}`, createMockUsage(0, 100, (i + 1) * 1000, 0)),
      ),
    );
  }

  const result = findCutPoint(entries, 0, entries.length, 2500);

  expect(entries[result.firstKeptEntryIndex]?.type).toBe("message");
  const role = (entries[result.firstKeptEntryIndex] as SessionMessageEntry).message.role;
  expect(role === "user" || role === "assistant").toBe(true);
};

const shouldReturnStartindexIfNoValidCut = () => {
  const entries: SessionEntry[] = [createMessageEntry(createAssistantMessage("a"))];
  const result = findCutPoint(entries, 0, entries.length, 1000);
  expect(result.firstKeptEntryIndex).toBe(0);
};

const shouldKeepEverythingIfAllMessagesFit = () => {
  const entries: SessionEntry[] = [
    createMessageEntry(createUserMessage("1")),
    createMessageEntry(createAssistantMessage("a", createMockUsage(0, 50, 500, 0))),
    createMessageEntry(createUserMessage("2")),
    createMessageEntry(createAssistantMessage("b", createMockUsage(0, 50, 1000, 0))),
  ];

  const result = findCutPoint(entries, 0, entries.length, 50000);
  expect(result.firstKeptEntryIndex).toBe(0);
};

const shouldIndicateSplitTurnWhenCuttingAt = () => {
  const entries: SessionEntry[] = [
    createMessageEntry(createUserMessage("Turn 1")),
    createMessageEntry(createAssistantMessage("A1", createMockUsage(0, 100, 1000, 0))),
    createMessageEntry(createUserMessage("Turn 2")),
    createMessageEntry(createAssistantMessage("A2-1", createMockUsage(0, 100, 5000, 0))),
    createMessageEntry(createAssistantMessage("A2-2", createMockUsage(0, 100, 8000, 0))),
    createMessageEntry(createAssistantMessage("A2-3", createMockUsage(0, 100, 10000, 0))),
  ];

  const result = findCutPoint(entries, 0, entries.length, 3000);

  const cutEntry = entries[result.firstKeptEntryIndex] as SessionMessageEntry;
  if (cutEntry.message.role === "assistant") {
    expect(result.isSplitTurn).toBe(true);
    expect(result.turnStartIndex).toBe(2);
  }
};

const shouldBudgetContextVisibleCustomMessageEntries = () => {
  const entries: SessionEntry[] = [
    createMessageEntry(createUserMessage("hi")),
    createMessageEntry(createAssistantMessage("hello")),
    createCustomMessageEntry("x".repeat(4000)),
    createMessageEntry(createAssistantMessage("ok")),
  ];

  const tinyBudget = findCutPoint(entries, 0, entries.length, 1);
  expect(tinyBudget.firstKeptEntryIndex).toBe(3);
  expect(tinyBudget.isSplitTurn).toBe(true);
  expect(tinyBudget.turnStartIndex).toBe(2);

  const customFitsBudget = findCutPoint(entries, 0, entries.length, 2);
  expect(customFitsBudget.firstKeptEntryIndex).toBe(2);
  expect(customFitsBudget.isSplitTurn).toBe(false);
  expect(customFitsBudget.turnStartIndex).toBe(-1);
};

const shouldFallBackToTheLatestValid = () => {
  const oldUser = createMessageEntry(createUserMessage("old history"));
  const oldAssistant = createMessageEntry(createAssistantMessage("old answer"));
  const currentUser = createMessageEntry(createUserMessage("read the large file"));
  const toolCall = createMessageEntry({
    ...createAssistantMessage(""),
    content: [
      { arguments: { path: "big.txt" }, id: "call-1", name: "read", type: "toolCall" as const },
    ],
    stopReason: "toolUse",
  });
  const toolResult = createMessageEntry({
    content: [{ text: "x".repeat(8000), type: "text" as const }],
    isError: false,
    role: "toolResult",
    timestamp: currentTimeMillis(),
    toolCallId: "call-1",
    toolName: "read",
  });
  const entries = [oldUser, oldAssistant, currentUser, toolCall, toolResult];

  const result = findCutPoint(entries, 0, entries.length, 1000);
  expect(result).toEqual({
    firstKeptEntryIndex: 3,
    isSplitTurn: true,
    turnStartIndex: 2,
  });

  const preparation = prepareCompaction(entries, {
    ...DEFAULT_COMPACTION_SETTINGS,
    keepRecentTokens: 1000,
  });
  expect(preparation?.firstKeptEntryId).toBe(toolCall.id);
  expect(preparation?.messagesToSummarize).toEqual([oldUser.message, oldAssistant.message]);
  expect(preparation?.turnPrefixMessages).toEqual([currentUser.message]);
};

describe("findCutPoint", () => {
  it("should find cut point based on actual token differences", shouldFindCutPointBasedOnActual);
  it(
    "should return startIndex if no valid cut points in range",
    shouldReturnStartindexIfNoValidCut,
  );
  it(
    "should keep everything if all messages fit within budget",
    shouldKeepEverythingIfAllMessagesFit,
  );
  it(
    "should indicate split turn when cutting at assistant message",
    shouldIndicateSplitTurnWhenCuttingAt,
  );
  it(
    "should budget context-visible custom message entries",
    shouldBudgetContextVisibleCustomMessageEntries,
  );
  it(
    "should fall back to the latest valid cut point before oversized trailing tool results",
    shouldFallBackToTheLatestValid,
  );
});
