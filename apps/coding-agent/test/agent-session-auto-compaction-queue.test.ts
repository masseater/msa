import { createAssistantMessageEventStream, fauxAssistantMessage } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import autoCompactionQueueSupport from "./agent-session-auto-compaction-queue-support.ts";

const { awaited, currentTimeMillis, runTest } = testing;
const {
  checkCompaction,
  cleanUp,
  harness,
  modelMessage,
  prepare,
  spyAutoCompaction,
  usage,
  userMessage,
} = autoCompactionQueueSupport;

const seedCompactableHistory = () => {
  const { session, sessionManager, settingsManager } = harness();
  settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
  const now = currentTimeMillis();
  sessionManager.appendMessage(userMessage("message to compact", now - 1000));
  sessionManager.appendMessage(
    modelMessage({ input: 100, text: "assistant response to compact", timestamp: now - 500 }),
  );
  session.agent.state.messages = sessionManager.buildSessionContext().messages;
};

const replyWithSummary = () => {
  harness().session.agent.streamFunction = (summaryModel) => {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() =>
      stream.push({
        message: {
          ...fauxAssistantMessage("compacted"),
          api: summaryModel.api,
          model: summaryModel.id,
          provider: summaryModel.provider,
          usage: usage(10),
        },
        reason: "stop",
        type: "done",
      }),
    );
    return stream;
  };
};

const resumesAfterThresholdCompactionWithAgentQueue = () =>
  runTest(
    Effect.gen(function* () {
      const { session } = harness();
      seedCompactableHistory();
      replyWithSummary();
      session.agent.followUp({
        content: [{ text: "Queued custom", type: "text" }],
        customType: "test",
        display: false,
        role: "custom",
        timestamp: currentTimeMillis(),
      });
      expect(session.pendingMessageCount).toBe(0);
      expect(session.agent.hasQueuedMessages()).toBe(true);
      const continueSpy = vi.spyOn(session.agent, "continue").mockResolvedValue();
      const runAutoCompaction = (
        session as unknown as {
          runAutoCompaction: (
            reason: "overflow" | "threshold",
            willRetry: boolean,
          ) => Promise<boolean>;
        }
      ).runAutoCompaction.bind(session);
      yield* awaited(expect(runAutoCompaction("threshold", false)).resolves.toBe(true));
      expect(continueSpy).not.toHaveBeenCalled();
    }),
  );

const compactionEndEvents = () => {
  const events: Array<{ type: string; reason: string; errorMessage?: string | undefined }> = [];
  harness().session.subscribe((event) => {
    if (event.type === "compaction_end") {
      events.push({ errorMessage: event.errorMessage, reason: event.reason, type: event.type });
    }
  });
  return events;
};

const compactsOnceAfterOverflowRecovery = () =>
  runTest(
    Effect.gen(function* () {
      const overflowMessage = modelMessage({ errorMessage: "prompt is too long" });
      const spy = spyAutoCompaction();
      const events = compactionEndEvents();
      yield* checkCompaction(overflowMessage);
      yield* checkCompaction({ ...overflowMessage, timestamp: currentTimeMillis() + 1 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(events).toContainEqual({
        errorMessage:
          "Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
        reason: "overflow",
        type: "compaction_end",
      });
    }),
  );

describe("AgentSession auto-compaction queue resume", () => {
  beforeEach(prepare);

  afterEach(cleanUp);

  it(
    "should resume after threshold compaction when only agent-level queued messages exist",
    resumesAfterThresholdCompactionWithAgentQueue,
  );

  it(
    "should not compact repeatedly after overflow recovery already attempted",
    compactsOnceAfterOverflowRecovery,
  );
});
