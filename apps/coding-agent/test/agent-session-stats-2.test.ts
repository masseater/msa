import { type ToolResultMessage, type Usage } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { SessionManager } from "../src/core/session-manager.ts";
import { getUsageCostBreakdown } from "../src/core/usage-totals.ts";
import agentSessionStatsSupport from "./agent-session-stats-support.ts";
const {
  createAssistantMessage,
  createSession,
  createUsage,
  createUserMessage,
  model,
  syncAgentMessages,
} = agentSessionStatsSupport;

const { awaited, runTest } = testing;

function createToolResultMessage(usage: Usage): ToolResultMessage {
  return {
    content: [{ text: "tool result", type: "text" as const }],
    isError: false,
    role: "toolResult",
    timestamp: 1,
    toolCallId: "tool-call-1",
    toolName: "test_tool",
    usage,
  };
}

const includesCompactionUsageInSessionTotals = () =>
  runTest(
    Effect.gen(function* () {
      const { session, sessionManager } = yield* awaited(createSession());

      try {
        const firstKeptEntryId = sessionManager.appendMessage(createUserMessage("hello", 1));
        sessionManager.appendCompaction("summary", firstKeptEntryId, 100, undefined, false, {
          cacheRead: 30,
          cacheWrite: 40,
          cost: { cacheRead: 0.3, cacheWrite: 0.4, input: 0.1, output: 0.2, total: 1 },
          input: 10,
          output: 20,
          totalTokens: 100,
        });
        syncAgentMessages(session, sessionManager);

        const stats = session.getSessionStats();
        expect(stats.tokens).toEqual({
          cacheRead: 30,
          cacheWrite: 40,
          input: 10,
          output: 20,
          total: 100,
        });
        expect(stats.cost).toBe(1);
      } finally {
        session.dispose();
      }
    }),
  );

const includesCacheWarmingUsageExactlyOnceWithout = () =>
  runTest(
    Effect.gen(function* () {
      const { session, sessionManager } = yield* awaited(createSession());

      try {
        sessionManager.appendUsage(
          "cache_warm",
          "anthropic-api",
          model.id,
          {
            cacheRead: 97,
            cacheWrite: 0,
            cost: { cacheRead: 0.007, cacheWrite: 0, input: 0.001, output: 0.002, total: 0.01 },
            input: 2,
            output: 1,
            totalTokens: 100,
          },
          "extension override",
        );

        const [entry] = sessionManager.getEntries();
        expect(entry).toMatchObject({
          kind: "cache_warm" as const,
          note: "extension override",
          type: "usage" as const,
        });
        const stats = session.getSessionStats();
        expect(stats.tokens).toEqual({
          cacheRead: 97,
          cacheWrite: 0,
          input: 2,
          output: 1,
          total: 100,
        });
        expect(stats.totalMessages).toBe(0);
        expect(sessionManager.buildSessionContext().messages).toEqual([]);
        expect(getUsageCostBreakdown(sessionManager.getEntries())).toEqual([
          { cost: 0.01, key: `anthropic/${model.id}`, tokens: 100 },
        ]);
      } finally {
        session.dispose();
      }
    }),
  );

const includesToolResultUsageInSessionTotals = () =>
  runTest(
    Effect.gen(function* () {
      const { session, sessionManager } = yield* awaited(createSession());

      try {
        sessionManager.appendMessage(
          createToolResultMessage({
            cacheRead: 30,
            cacheWrite: 40,
            cost: { cacheRead: 0.3, cacheWrite: 0.4, input: 0.1, output: 0.2, total: 1 },
            input: 10,
            output: 20,
            totalTokens: 100,
          }),
        );
        syncAgentMessages(session, sessionManager);

        const stats = session.getSessionStats();
        expect(stats.tokens).toEqual({
          cacheRead: 30,
          cacheWrite: 40,
          input: 10,
          output: 20,
          total: 100,
        });
        expect(stats.cost).toBe(1);
      } finally {
        session.dispose();
      }
    }),
  );

const groupsToolAndSummaryUsageSeparatelyFrom = () => {
  const sessionManager = SessionManager.inMemory();
  const rootId = sessionManager.appendMessage(createUserMessage("hello", 1));
  sessionManager.appendMessage({
    ...createAssistantMessage("response", 100, 2),
    usage: { ...createUsage(100), cost: { ...createUsage(100).cost, total: 0.5 } },
  });
  sessionManager.appendMessage(
    createToolResultMessage({
      ...createUsage(100),
      cost: { ...createUsage(100).cost, total: 1 },
    }),
  );
  sessionManager.appendCompaction("summary", rootId, 100, undefined, false, {
    ...createUsage(100),
    cost: { ...createUsage(100).cost, total: 2 },
  });
  sessionManager.branchWithSummary(null, "branch summary", undefined, false, {
    ...createUsage(100),
    cost: { ...createUsage(100).cost, total: 3 },
  });

  expect(getUsageCostBreakdown(sessionManager.getEntries())).toEqual([
    { cost: 6, key: "Tools/summaries", tokens: 300 },
    { cost: 0.5, key: `${model.provider}/${model.id}`, tokens: 100 },
  ]);
};

describe("AgentSession.getSessionStats", () => {
  it("includes compaction usage in session totals", includesCompactionUsageInSessionTotals);

  it(
    "includes cache-warming usage exactly once without adding messages",
    includesCacheWarmingUsageExactlyOnceWithout,
  );

  it("includes tool result usage in session totals", includesToolResultUsageInSessionTotals);

  it(
    "groups tool and summary usage separately from model-attributed usage",
    groupsToolAndSummaryUsageSeparatelyFrom,
  );
});
