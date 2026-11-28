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

const hello = () => createMessageEntry(createUserMessage("Hello"));
const hi = () => createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50)));

const usageCases: {
  readonly entries: () => sessionManagerTypes.SessionEntry[];
  readonly expectedInput: number | undefined;
  readonly name: string;
}[] = [
  {
    entries: () => [
      hello(),
      hi(),
      createMessageEntry(createUserMessage("How are you?")),
      createMessageEntry(createAssistantMessage("Good", createMockUsage(200, 100))),
    ],
    expectedInput: 200,
    name: "should find the last non-aborted assistant message usage",
  },
  {
    entries: () => [
      hello(),
      hi(),
      createMessageEntry(createUserMessage("How are you?")),
      createMessageEntry({
        ...createAssistantMessage("Aborted", createMockUsage(300, 150)),
        stopReason: "aborted",
      }),
    ],
    expectedInput: 100,
    name: "should skip aborted messages",
  },
  {
    entries: () => [
      hello(),
      hi(),
      createMessageEntry(createUserMessage("continue")),
      createMessageEntry(createAssistantMessage("Partial", createMockUsage(0, 0))),
    ],
    expectedInput: 100,
    name: "should skip all-zero assistant usage",
  },
  {
    entries: () => [hello()],
    expectedInput: undefined,
    name: "should return undefined if no assistant messages",
  },
];

describe("getLastAssistantUsage", () => {
  it.each(usageCases)("$name", ({ entries, expectedInput }) => {
    expect(getLastAssistantUsage(entries())?.input).toBe(expectedInput);
  });
});
