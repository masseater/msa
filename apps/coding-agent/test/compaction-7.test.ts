import testing from "@msa/testing";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import compaction from "../src/core/compaction/index.ts";
import compactionSupport from "./compaction-support.ts";

const { createAssistantMessage, createMessageEntry, createUserMessage, resetEntryCounter } =
  compactionSupport;

const { DEFAULT_COMPACTION_SETTINGS, prepareCompaction } = compaction;

const { currentTimeMillis } = testing;

beforeEach(() => {
  resetEntryCounter();
});

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
