import type compatTypes from "@msa/ai/compat.types";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import compaction from "../src/core/compaction/index.ts";
import type sessionManagerTypes from "../src/core/session-manager.types.ts";
import compactionSupport from "./compaction-support.ts";

const {
  createAssistantMessage,
  createMessageEntry,
  createMockUsage,
  createUserMessage,
  resetEntryCounter,
} = compactionSupport;

const { getLastAssistantUsage } = compaction;

beforeEach(() => {
  resetEntryCounter();
});

const shouldFindTheLastNonAbortedAssistant = () => {
  const entries: sessionManagerTypes.SessionEntry[] = [
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
  const abortedMsg: compatTypes.AssistantMessage = {
    ...createAssistantMessage("Aborted", createMockUsage(300, 150)),
    stopReason: "aborted",
  };

  const entries: sessionManagerTypes.SessionEntry[] = [
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
  const entries: sessionManagerTypes.SessionEntry[] = [
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
  const entries: sessionManagerTypes.SessionEntry[] = [
    createMessageEntry(createUserMessage("Hello")),
  ];
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
