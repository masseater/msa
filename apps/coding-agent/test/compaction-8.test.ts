import type agentTypes from "@msa/agent-core/index.types";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import compaction from "../src/core/compaction/index.ts";
import type compactionTypes from "../src/core/compaction/index.types.ts";
import compactionSupport from "./compaction-support.ts";

const {
  createAssistantMessage,
  createCompactionEntry,
  createMessageEntry,
  createMockUsage,
  createUserMessage,
  resetEntryCounter,
} = compactionSupport;

const { DEFAULT_COMPACTION_SETTINGS, prepareCompaction } = compaction;

beforeEach(() => {
  resetEntryCounter();
});

function extractText(messages: agentTypes.AgentMessage[]): string {
  return messages
    .map((message) => {
      switch (message.role) {
        case "user":
          return typeof message.content === "string"
            ? message.content
            : message.content
                .filter((block): block is { type: "text"; text: string } => block.type === "text")
                .map((block) => block.text)
                .join(" ");
        case "assistant":
          return message.content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text)
            .join(" ");
        case "branchSummary":
        case "compactionSummary":
          return message.summary;
        case "custom":
        case "toolResult":
          return typeof message.content === "string"
            ? message.content
            : message.content
                .filter((block): block is { type: "text"; text: string } => block.type === "text")
                .map((block) => block.text)
                .join(" ");
        case "bashExecution":
          return `${message.command}\n${message.output}`;
        default:
          return "";
      }
    })
    .join("\n");
}

const shouldSkipRepeatedCompactionsWhenKeptMessages = () => {
  const u1 = createMessageEntry(createUserMessage("user msg 1 (summarized by compaction1)"));
  const a1 = createMessageEntry(createAssistantMessage("assistant msg 1"));
  const u2 = createMessageEntry(createUserMessage("user msg 2 - kept by compaction1"));
  const a2 = createMessageEntry(createAssistantMessage("assistant msg 2"));
  const u3 = createMessageEntry(createUserMessage("user msg 3 - kept by compaction1"));
  const a3 = createMessageEntry(
    createAssistantMessage("assistant msg 3", createMockUsage(5000, 1000)),
  );
  const compaction1 = createCompactionEntry("First summary", u2.id);
  const u4 = createMessageEntry(createUserMessage("user msg 4 (new after compaction1)"));
  const a4 = createMessageEntry(
    createAssistantMessage("assistant msg 4", createMockUsage(8000, 2000)),
  );

  const pathEntries = [u1, a1, u2, a2, u3, a3, compaction1, u4, a4];
  const preparation = prepareCompaction(pathEntries, DEFAULT_COMPACTION_SETTINGS);

  expect(preparation).toBeUndefined();
};

const shouldReSummarizePreviouslyKeptMessagesWhen = () => {
  const u1 = createMessageEntry(
    createUserMessage("user msg 1 (summarized by compaction1)".repeat(4)),
  );
  const a1 = createMessageEntry(createAssistantMessage("assistant msg 1".repeat(4)));
  const u2 = createMessageEntry(createUserMessage("user msg 2 - kept by compaction1 ".repeat(12)));
  const a2 = createMessageEntry(createAssistantMessage("assistant msg 2 ".repeat(12)));
  const u3 = createMessageEntry(createUserMessage("user msg 3 - kept by compaction1 ".repeat(12)));
  const a3 = createMessageEntry(
    createAssistantMessage("assistant msg 3 ".repeat(12), createMockUsage(5000, 1000)),
  );
  const compaction1 = createCompactionEntry("First summary", u2.id);
  const u4 = createMessageEntry(
    createUserMessage("user msg 4 (new after compaction1) ".repeat(12)),
  );
  const a4 = createMessageEntry(
    createAssistantMessage("assistant msg 4 ".repeat(12), createMockUsage(8000, 2000)),
  );

  const settings: compactionTypes.CompactionSettings = {
    ...DEFAULT_COMPACTION_SETTINGS,
    keepRecentTokens: 100,
  };
  const preparation = prepareCompaction([u1, a1, u2, a2, u3, a3, compaction1, u4, a4], settings);

  expect(preparation).toBeDefined();
  const summarizedText = extractText(preparation!.messagesToSummarize);
  expect(summarizedText).toContain("user msg 2 - kept by compaction1");
  expect(summarizedText).toContain("user msg 3 - kept by compaction1");
  expect(summarizedText).not.toContain("First summary");
  expect(preparation!.previousSummary).toBe("First summary");
};

describe("prepareCompaction with previous compaction", () => {
  it(
    "should skip repeated compactions when kept messages still fit",
    shouldSkipRepeatedCompactionsWhenKeptMessages,
  );
  it(
    "should re-summarize previously kept messages when the recent window moves past them",
    shouldReSummarizePreviouslyKeptMessagesWhen,
  );
});
