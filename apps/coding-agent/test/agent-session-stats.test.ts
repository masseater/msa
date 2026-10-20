import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import agentSessionStatsSupport from "./agent-session-stats-support.ts";
const { createAssistantMessage, createSession, createUserMessage, model, syncAgentMessages } =
  agentSessionStatsSupport;

const { awaited, runTest } = testing;

const exposesTheCurrentContextUsageAlongsideToken = () =>
  runTest(
    Effect.gen(function* () {
      const { session, sessionManager } = yield* awaited(createSession());

      try {
        sessionManager.appendMessage(createUserMessage("hello", 1));
        sessionManager.appendMessage(createAssistantMessage("hi", 200, 2));
        syncAgentMessages(session, sessionManager);

        const stats = session.context.stats.getSessionStats();
        expect(stats.contextUsage).toEqual(session.context.stats.getContextUsage());
        expect(stats.contextUsage?.tokens).toBe(200);
        expect(stats.contextUsage?.contextWindow).toBe(model.contextWindow);
        expect(stats.contextUsage?.percent).toBe((200 / model.contextWindow) * 100);
      } finally {
        session.dispose();
      }
    }),
  );

const reportsUnknownCurrentContextUsageImmediatelyAfter = () =>
  runTest(
    Effect.gen(function* () {
      const { session, sessionManager } = yield* awaited(createSession());

      try {
        sessionManager.appendMessage(createUserMessage("first", 1));
        sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
        const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
        sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
        sessionManager.appendCompaction("summary", keptUserId, 195_000);
        sessionManager.appendMessage(createUserMessage("third", 5));
        syncAgentMessages(session, sessionManager);

        const stats = session.context.stats.getSessionStats();

        expect(stats.tokens.input).toBe(375_000);
        expect(stats.contextUsage).toBeDefined();
        expect(stats.contextUsage?.tokens).toBeNull();
        expect(stats.contextUsage?.percent).toBeNull();
      } finally {
        session.dispose();
      }
    }),
  );

const usesPostCompactionUsageForCurrentContext = () =>
  runTest(
    Effect.gen(function* () {
      const { session, sessionManager } = yield* awaited(createSession());

      try {
        sessionManager.appendMessage(createUserMessage("first", 1));
        sessionManager.appendMessage(createAssistantMessage("response1", 180_000, 2));
        const keptUserId = sessionManager.appendMessage(createUserMessage("second", 3));
        sessionManager.appendMessage(createAssistantMessage("response2", 195_000, 4));
        sessionManager.appendCompaction("summary", keptUserId, 195_000);
        sessionManager.appendMessage(createUserMessage("third", 5));
        sessionManager.appendMessage(createAssistantMessage("response3", 25_000, 6));
        syncAgentMessages(session, sessionManager);

        const stats = session.context.stats.getSessionStats();

        expect(stats.tokens.input).toBe(400_000);
        expect(stats.contextUsage).toBeDefined();
        expect(stats.contextUsage?.tokens).toBe(25_000);
        expect(stats.contextUsage?.percent).toBe((25_000 / model.contextWindow) * 100);
      } finally {
        session.dispose();
      }
    }),
  );

const includesBranchSummaryUsageInSessionTotals = () =>
  runTest(
    Effect.gen(function* () {
      const { session, sessionManager } = yield* awaited(createSession());

      try {
        sessionManager.branchWithSummary(null, "summary", undefined, false, {
          cacheRead: 30,
          cacheWrite: 40,
          cost: { cacheRead: 0.3, cacheWrite: 0.4, input: 0.1, output: 0.2, total: 1 },
          input: 10,
          output: 20,
          totalTokens: 100,
        });
        syncAgentMessages(session, sessionManager);

        const stats = session.context.stats.getSessionStats();
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

describe("AgentSession.getSessionStats", () => {
  it(
    "exposes the current context usage alongside token totals",
    exposesTheCurrentContextUsageAlongsideToken,
  );

  it(
    "reports unknown current context usage immediately after compaction",
    reportsUnknownCurrentContextUsageImmediatelyAfter,
  );

  it(
    "uses post-compaction usage for current context instead of stale kept usage",
    usesPostCompactionUsageForCurrentContext,
  );

  it("includes branch summary usage in session totals", includesBranchSummaryUsageInSessionTotals);
});
