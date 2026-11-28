import { beforeEach, describe, expect, it } from "vite-plus/test";

import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import sessionContext from "../src/core/session-manager/session-context.ts";
import compactionSupport from "./compaction-support.ts";

const {
  createAssistantMessage,
  createCompactionEntry,
  createMessageEntry,
  createModelChangeEntry,
  createThinkingLevelEntry,
  createUserMessage,
  resetEntryCounter,
} = compactionSupport;

const { buildSessionContext } = sessionContext;

beforeEach(() => {
  resetEntryCounter();
});

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
