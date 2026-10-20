import testing from "@msa/testing";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_COMPACTION_SETTINGS,
  estimateProjectedContextTokens,
  prepareCompaction,
} from "../src/core/compaction/index.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import sessionContextEditSupport from "./session-context-edit-support.ts";

const { assistant } = sessionContextEditSupport;

const { currentTimeMillis } = testing;

const usesAssistantUsageCapturedAfterTheLatest = () => {
  const session = SessionManager.inMemory();
  const userId = session.appendMessage({
    content: "original",
    role: "user",
    timestamp: currentTimeMillis(),
  });
  session.appendContextEdit(userId, { content: "edited" });
  const response = assistant("answer");
  response.usage = { ...response.usage, input: 4_000, output: 100, totalTokens: 4_100 };
  session.appendMessage(response);
  session.appendMessage({ content: "next", role: "user", timestamp: currentTimeMillis() });

  const estimate = estimateProjectedContextTokens(
    session.buildSessionProjection(),
    session.getBranch(),
  );
  expect(estimate.usageTokens).toBe(4_100);
  expect(estimate.trailingTokens).toBe(1);
  expect(estimate.tokens).toBe(4_101);
};

const doesNotReusePostEditAssistantUsage = () => {
  const session = SessionManager.inMemory();
  const userId = session.appendMessage({
    content: "small input",
    role: "user",
    timestamp: currentTimeMillis(),
  });
  session.appendContextEdit(userId, { content: "edited input" });
  const response = assistant("answer");
  response.usage = { ...response.usage, input: 50_000, output: 1, totalTokens: 50_001 };
  session.appendMessage(response);
  session.appendCompaction("small summary", userId, 50_001);

  const estimate = estimateProjectedContextTokens(
    session.buildSessionProjection(),
    session.getBranch(),
  );
  expect(estimate.usageTokens).toBe(0);
  expect(estimate.tokens).toBeLessThan(100);
};

const includesEffectiveSystemAndToolContextIn = () => {
  const session = SessionManager.inMemory();
  session.appendMessage({
    content: "system prompt ".repeat(3_000),
    role: "system",
    timestamp: currentTimeMillis(),
    toolsAdded: [
      {
        description: "tool declaration ".repeat(100),
        name: "example",
        parameters: { properties: {}, type: "object" as const },
      },
    ],
  });
  const userId = session.appendMessage({
    content: "ask",
    role: "user",
    timestamp: currentTimeMillis(),
  });
  session.appendMessage(assistant("done"));
  session.appendContextEdit(userId, { content: "ask" });

  expect(
    estimateProjectedContextTokens(session.buildSessionProjection(), session.getBranch()).tokens,
  ).toBeGreaterThan(10_000);
};

const doesNotAdvancePastABoundaryReplacement = () => {
  const session = SessionManager.inMemory();
  session.appendMessage({ content: "old request", role: "user", timestamp: currentTimeMillis() });
  session.appendMessage(assistant("old answer"));
  const replacedUserId = session.appendMessage({
    content: "original input",
    role: "user",
    timestamp: currentTimeMillis(),
  });
  const assistantId = session.appendMessage(assistant("answered original input"));
  session.appendContextEdit(replacedUserId, { content: "NEW-INSTRUCTION ".repeat(100) });
  session.appendContextEdit(assistantId, null);
  session.appendCustomEntry("bookkeeping", { source: "test" });

  const preparation = prepareCompaction(session.getBranch(), {
    ...DEFAULT_COMPACTION_SETTINGS,
    keepRecentTokens: 1,
  });
  expect(preparation?.firstKeptEntryId).toBe(replacedUserId);
  expect(JSON.stringify(preparation?.messagesToSummarize)).not.toContain("NEW-INSTRUCTION");
  expect(JSON.stringify(preparation?.turnPrefixMessages)).not.toContain("NEW-INSTRUCTION");
};

const doesNotLetMetadataMoveTheCut = () => {
  const session = SessionManager.inMemory();
  session.appendMessage({ content: "old request", role: "user", timestamp: currentTimeMillis() });
  session.appendMessage(assistant("old answer"));
  const instructionId = session.appendCustomMessageEntry(
    "next-work",
    "UNSENT-INSTRUCTION ".repeat(100),
    false,
  );
  session.appendCustomEntry("bookkeeping", { source: "test" });

  const preparation = prepareCompaction(session.getBranch(), {
    ...DEFAULT_COMPACTION_SETTINGS,
    keepRecentTokens: 1,
  });
  expect(preparation?.firstKeptEntryId).toBe(instructionId);
  expect(JSON.stringify(preparation?.messagesToSummarize)).not.toContain("UNSENT-INSTRUCTION");
  expect(JSON.stringify(preparation?.turnPrefixMessages)).not.toContain("UNSENT-INSTRUCTION");
};

const doesNotTreatAnOmittedCustomMessage = () => {
  const session = SessionManager.inMemory();
  session.appendMessage({
    content: "unanswered input ".repeat(100),
    role: "user",
    timestamp: currentTimeMillis(),
  });
  const customId = session.appendCustomMessageEntry("temporary", "temporary context", false);
  session.appendContextEdit(customId, null);

  const preparation = prepareCompaction(session.getBranch(), {
    ...DEFAULT_COMPACTION_SETTINGS,
    keepRecentTokens: 1,
  });
  expect(preparation).toBeUndefined();
};

const advancesPastInputForAnOmittedAssistant = () => {
  const session = SessionManager.inMemory();
  const userId = session.appendMessage({
    content: "recovery input ".repeat(100),
    role: "user",
    timestamp: currentTimeMillis(),
  });
  const attemptId = session.appendMessage(assistant("failed attempt"));
  session.appendContextEdit(attemptId, null);
  session.appendCustomEntry("bookkeeping", { source: "test" });

  const preparation = prepareCompaction(session.getBranch(), {
    ...DEFAULT_COMPACTION_SETTINGS,
    keepRecentTokens: 1,
  });
  expect(preparation?.firstKeptEntryId).toBe(attemptId);
  expect(preparation?.turnPrefixMessages).toEqual([
    expect.objectContaining({ content: expect.stringContaining("recovery input"), role: "user" }),
  ]);
  expect(preparation?.messagesToSummarize).not.toContainEqual(
    expect.objectContaining({ content: expect.stringContaining("recovery input"), role: "user" }),
  );
  expect(userId).not.toBe(attemptId);
};

const preparesCompactionFromEditedModelContent = () => {
  const session = SessionManager.inMemory();
  const omittedId = session.appendMessage({
    content: "OMIT-ME ".repeat(100),
    role: "user",
    timestamp: currentTimeMillis(),
  });
  session.appendMessage(assistant("old answer ".repeat(100)));
  session.appendContextEdit(omittedId, null);
  session.appendMessage({ content: "keep", role: "user", timestamp: currentTimeMillis() });
  session.appendMessage(assistant("suffix"));

  const preparation = prepareCompaction(session.getBranch(), {
    ...DEFAULT_COMPACTION_SETTINGS,
    keepRecentTokens: 1,
  });
  expect(preparation).toBeDefined();
  expect(JSON.stringify(preparation?.messagesToSummarize)).not.toContain("OMIT-ME");
  expect(JSON.stringify(preparation?.turnPrefixMessages)).not.toContain("OMIT-ME");
};

describe("session context edits", () => {
  it(
    "uses assistant usage captured after the latest context edit",
    usesAssistantUsageCapturedAfterTheLatest,
  );

  it(
    "does not reuse post-edit assistant usage after a later compaction",
    doesNotReusePostEditAssistantUsage,
  );

  it(
    "includes effective system and tool context in edited estimates",
    includesEffectiveSystemAndToolContextIn,
  );

  it(
    "does not advance past a boundary replacement of the candidate input",
    doesNotAdvancePastABoundaryReplacement,
  );

  it("does not let metadata move the cut past unsent boundary input", doesNotLetMetadataMoveTheCut);

  it(
    "does not treat an omitted custom message as a recovery attempt",
    doesNotTreatAnOmittedCustomMessage,
  );

  it(
    "advances past input for an omitted assistant recovery suffix with metadata",
    advancesPastInputForAnOmittedAssistant,
  );

  it("prepares compaction from edited model content", preparesCompactionFromEditedModelContent);
});
