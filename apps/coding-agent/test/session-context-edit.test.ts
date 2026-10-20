import type { AssistantMessage, ToolResultMessage } from "@msa/ai";
import testing from "@msa/testing";
import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_COMPACTION_SETTINGS,
  estimateProjectedContextTokens,
  prepareCompaction,
} from "../src/core/compaction/index.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import sessionContextEditSupport from "./session-context-edit-support.ts";

const { assistant, text } = sessionContextEditSupport;

const { currentTimeMillis } = testing;

const omitsATargetOnlyFromModelProjection = () => {
  const session = SessionManager.inMemory();
  session.appendMessage({ content: "request", role: "user", timestamp: currentTimeMillis() });
  const assistantId = session.appendMessage(assistant("partial"));
  const result: ToolResultMessage = {
    content: [{ text: "raw output", type: "text" as const }],
    details: { path: "large.txt" },
    isError: true,
    role: "toolResult",
    timestamp: currentTimeMillis(),
    toolCallId: "call-1",
    toolName: "read",
  };
  const resultId = session.appendMessage(result);
  session.appendContextEdit(assistantId, null);
  session.appendContextEdit(resultId, null);

  expect(session.getBranch().filter((entry) => entry.type === "message")).toHaveLength(3);
  expect(session.buildSessionProjection().messages.map((message) => message.role)).toEqual([
    "user",
  ]);
  expect((session.getEntry(resultId) as { message: ToolResultMessage }).message).toBe(result);
};

const replacesOnlyContentAndLetsTheLatest = () => {
  const session = SessionManager.inMemory();
  const targetId = session.appendMessage(assistant("original"));
  session.appendContextEdit(targetId, { content: [{ text: "first", type: "text" as const }] });
  session.appendContextEdit(targetId, null);
  session.appendContextEdit(targetId, { content: [{ text: "restored", type: "text" as const }] });

  const projected = session.buildSessionProjection().messages[0];
  expect(projected?.role).toBe("assistant");
  if (projected?.role !== "assistant") throw new Error("expected assistant");
  expect(text(projected)).toBe("restored");
  expect(projected.usage.totalTokens).toBe(11);
  expect(text((session.getEntry(targetId) as { message: AssistantMessage }).message)).toBe(
    "original",
  );
};

const normalizesStringReplacementsForArrayOnlyAssistant = () => {
  const session = SessionManager.inMemory();
  const assistantId = session.appendMessage(assistant("original"));
  const resultId = session.appendMessage({
    content: [{ text: "original result", type: "text" as const }],
    isError: false,
    role: "toolResult",
    timestamp: currentTimeMillis(),
    toolCallId: "call-1",
    toolName: "read",
  });
  const assistantEditId = session.appendContextEdit(assistantId, {
    content: "assistant replacement",
  });
  const resultEditId = session.appendContextEdit(resultId, { content: "result replacement" });

  expect(session.getEntry(assistantEditId)).toMatchObject({
    replacement: { content: [{ text: "assistant replacement", type: "text" as const }] },
  });
  expect(session.getEntry(resultEditId)).toMatchObject({
    replacement: { content: [{ text: "result replacement", type: "text" as const }] },
  });
  const projected = session.buildSessionProjection().messages;
  expect(projected[0]).toMatchObject({
    content: [{ text: "assistant replacement", type: "text" as const }],
    role: "assistant",
  });
  expect(projected[1]).toMatchObject({
    content: [{ text: "result replacement", type: "text" as const }],
    role: "toolResult",
  });
};

const normalizesImportedStringReplacementsWhileProjectingArray = () => {
  const session = SessionManager.inMemory();
  const assistantId = session.appendMessage(assistant("original"));
  const editId = session.appendContextEdit(assistantId, null);
  const edit = session.getEntry(editId);
  if (edit?.type !== "context_edit") throw new Error("expected context edit");
  edit.replacement = { content: "imported replacement" };

  expect(session.buildSessionProjection().messages[0]).toMatchObject({
    content: [{ text: "imported replacement", type: "text" as const }],
    role: "assistant",
  });
};

const keepsEditsBranchRelative = () => {
  const session = SessionManager.inMemory();
  const targetId = session.appendMessage({
    content: "original",
    role: "user",
    timestamp: currentTimeMillis(),
  });
  session.appendContextEdit(targetId, { content: "edited" });
  expect(text(session.buildSessionProjection().messages[0] as { content: string })).toBe("edited");

  session.branch(targetId);
  expect(text(session.buildSessionProjection().messages[0] as { content: string })).toBe(
    "original",
  );
};

const usesASelfReferencingCompactionToRetain = () => {
  const session = SessionManager.inMemory();
  session.appendMessage({ content: "discarded", role: "user", timestamp: currentTimeMillis() });
  const compactionId = session.appendCompaction("exact handoff", null, 100);
  session.appendMessage({ content: "after", role: "user", timestamp: currentTimeMillis() });

  const compaction = session.getEntry(compactionId);
  expect(compaction).toMatchObject({
    firstKeptEntryId: compactionId,
    type: "compaction" as const,
  });
  expect(session.buildSessionProjection().messages.map((message) => message.role)).toEqual([
    "compactionSummary",
    "user",
  ]);
  expect(
    session
      .buildSessionProjection()
      .messages.map((message) =>
        "summary" in message ? message.summary : text(message as { content: string }),
      ),
  ).toEqual(["exact handoff", "after"]);
};

const appliesPostCompactionEditsToRetainedPre = () => {
  const session = SessionManager.inMemory();
  session.appendMessage({ content: "summarized", role: "user", timestamp: currentTimeMillis() });
  const retainedId = session.appendMessage({
    content: "original retained",
    role: "user",
    timestamp: currentTimeMillis(),
  });
  session.appendCompaction("summary", retainedId, 100);
  session.appendContextEdit(retainedId, { content: "edited retained" });

  expect(
    session
      .buildSessionProjection()
      .messages.map((message) =>
        "summary" in message ? message.summary : text(message as { content: string }),
      ),
  ).toEqual(["summary", "edited retained"]);
};

const usesOnlyTheNewestSummaryWhenA = () => {
  const session = SessionManager.inMemory();
  session.appendMessage({
    content: "summarized first",
    role: "user",
    timestamp: currentTimeMillis(),
  });
  const retainedId = session.appendMessage({
    content: "retained",
    role: "user",
    timestamp: currentTimeMillis(),
  });
  session.appendCompaction("first summary", retainedId, 100);
  session.appendMessage(assistant("after first compaction"));
  session.appendCompaction("second summary", retainedId, 80);
  session.appendMessage({
    content: "new tail ".repeat(100),
    role: "user",
    timestamp: currentTimeMillis(),
  });

  const summaries = session
    .buildSessionProjection()
    .messages.flatMap((message) => ("summary" in message ? [message.summary] : []));
  expect(summaries).toEqual(["second summary"]);
  const preparation = prepareCompaction(session.getBranch(), {
    ...DEFAULT_COMPACTION_SETTINGS,
    keepRecentTokens: 1,
  });
  expect(preparation?.previousSummary).toBe("second summary");
};

const supportsRepeatedRetainNoneCompactions = () => {
  const session = SessionManager.inMemory();
  session.appendMessage({ content: "discarded", role: "user", timestamp: currentTimeMillis() });
  session.appendCompaction("first handoff", null, 100);
  session.appendMessage({
    content: "also discarded",
    role: "user",
    timestamp: currentTimeMillis(),
  });
  const secondId = session.appendCompaction("second handoff", null, 50);

  expect(session.getEntry(secondId)).toMatchObject({ firstKeptEntryId: secondId });
  expect(
    session
      .buildSessionProjection()
      .messages.map((message) => ("summary" in message ? message.summary : "")),
  ).toEqual(["second handoff"]);
};

const doesNotTrustPreEditAssistantUsage = () => {
  const session = SessionManager.inMemory();
  const largeUserId = session.appendMessage({
    content: "discarded input ".repeat(2_000),
    role: "user",
    timestamp: currentTimeMillis(),
  });
  const response = assistant("small answer");
  response.usage = { ...response.usage, input: 10_000, totalTokens: 10_001 };
  const assistantId = session.appendMessage(response);
  session.appendContextEdit(largeUserId, null);

  const editedEstimate = estimateProjectedContextTokens(
    session.buildSessionProjection(),
    session.getBranch(),
  );
  expect(editedEstimate.usageTokens).toBe(0);
  expect(editedEstimate.tokens).toBeLessThan(100);

  session.appendContextEdit(assistantId, null);
  expect(
    estimateProjectedContextTokens(session.buildSessionProjection(), session.getBranch()).tokens,
  ).toBe(0);
};

describe("session context edits", () => {
  it("omits a target only from model projection", omitsATargetOnlyFromModelProjection);

  it("replaces only content and lets the latest edit win", replacesOnlyContentAndLetsTheLatest);

  it(
    "normalizes string replacements for array-only assistant and tool-result roles",
    normalizesStringReplacementsForArrayOnlyAssistant,
  );

  it(
    "normalizes imported string replacements while projecting array-only roles",
    normalizesImportedStringReplacementsWhileProjectingArray,
  );

  it("keeps edits branch-relative", keepsEditsBranchRelative);

  it(
    "uses a self-referencing compaction to retain no preceding entries",
    usesASelfReferencingCompactionToRetain,
  );

  it(
    "applies post-compaction edits to retained pre-compaction entries",
    appliesPostCompactionEditsToRetainedPre,
  );

  it(
    "uses only the newest summary when a repeated compaction retains entries before the older compaction",
    usesOnlyTheNewestSummaryWhenA,
  );

  it("supports repeated retain-none compactions", supportsRepeatedRetainNoneCompactions);

  it(
    "does not trust pre-edit assistant usage for projected context estimates",
    doesNotTrustPreEditAssistantUsage,
  );
});
