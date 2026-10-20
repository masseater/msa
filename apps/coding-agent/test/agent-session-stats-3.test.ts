import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import agentSessionStatsSupport from "./agent-session-stats-support.ts";
const { createAssistantMessage, createSession, createUserMessage, syncAgentMessages } =
  agentSessionStatsSupport;

const { awaited, runTest } = testing;

const ignoresZeroUsageMessagesWhenCheckingFor = () =>
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
        sessionManager.appendMessage(createUserMessage("continue", 7));
        sessionManager.appendMessage(createAssistantMessage("partial", 0, 8));
        syncAgentMessages(session, sessionManager);

        const stats = session.getSessionStats();
        expect(stats.contextUsage).toBeDefined();
        expect(stats.contextUsage?.tokens).not.toBeNull();
        expect(stats.contextUsage?.tokens ?? 0).toBeGreaterThan(25_000);
      } finally {
        session.dispose();
      }
    }),
  );

describe("AgentSession.getSessionStats", () => {
  it(
    "ignores zero-usage messages when checking for post-compaction context usage",
    ignoresZeroUsageMessagesWhenCheckingFor,
  );
});
