import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import autoCompactionQueueSupport from "./agent-session-auto-compaction-queue-support.ts";

const { currentTimeMillis, runTest } = testing;
const {
  appendCompactedHistory,
  checkCompaction,
  cleanUp,
  harness,
  modelMessage,
  overloaded,
  prepare,
  spyAutoCompaction,
  userMessage,
} = autoCompactionQueueSupport;

const ignoresStalePreCompactionUsage = () =>
  runTest(
    Effect.gen(function* () {
      const { sessionManager } = harness();
      const staleAssistant = modelMessage({
        input: 600_000,
        output: 10_000,
        text: "large response before compaction",
        timestamp: currentTimeMillis() - 10_000,
      });
      appendCompactedHistory(staleAssistant, "before compaction");
      sessionManager.appendMessage(userMessage("session recovery payload", currentTimeMillis()));
      const spy = spyAutoCompaction();
      yield* checkCompaction(staleAssistant, false);
      expect(spy).not.toHaveBeenCalled();
    }),
  );

const arrangeLastSuccess = () => {
  const { session, settingsManager } = harness();
  const contextWindow = session.model!.contextWindow ?? 200_000;
  const thresholdTokens =
    contextWindow - settingsManager.context.getCompactionSettings().reserveTokens + 1;
  const errorAssistant = overloaded(currentTimeMillis() + 1000);
  session.agent.state.messages = [
    userMessage("hello", currentTimeMillis() - 1000),
    modelMessage({
      input: thresholdTokens - 10_000,
      output: 10_000,
      text: "large successful response",
    }),
    userMessage("another prompt", currentTimeMillis() + 500),
    errorAssistant,
  ];
  return errorAssistant;
};

const arrangeWithoutUsage = () => {
  const errorAssistant = overloaded();
  harness().session.agent.state.messages = [
    userMessage("hello", currentTimeMillis() - 1000),
    errorAssistant,
  ];
  return errorAssistant;
};

const arrangeKeptUsageOnly = () => {
  const preCompactionTimestamp = currentTimeMillis() - 10_000;
  const keptAssistant = modelMessage({
    input: 180_000,
    output: 10_000,
    text: "kept response from before compaction",
    timestamp: preCompactionTimestamp,
  });
  appendCompactedHistory(keptAssistant, "before compaction");
  const errorAssistant = overloaded();
  harness().session.agent.state.messages = [
    userMessage("kept user msg", preCompactionTimestamp - 1000),
    keptAssistant,
    userMessage("new prompt", currentTimeMillis() - 500),
    errorAssistant,
  ];
  return errorAssistant;
};

const thresholdCases = [
  {
    arrange: arrangeLastSuccess,
    name: "should trigger threshold compaction for error messages using last successful usage",
    triggers: true,
  },
  {
    arrange: arrangeWithoutUsage,
    name: "should not trigger threshold compaction for error messages when no prior usage exists",
    triggers: false,
  },
  {
    arrange: arrangeKeptUsageOnly,
    name: "should not trigger threshold compaction for error messages when only kept pre-compaction usage exists",
    triggers: false,
  },
];

describe("AgentSession auto-compaction queue resume", () => {
  beforeEach(prepare);

  afterEach(cleanUp);

  it(
    "should ignore stale pre-compaction assistant usage on pre-prompt compaction checks",
    ignoresStalePreCompactionUsage,
  );

  it.each(thresholdCases)("$name", ({ arrange, triggers }) =>
    runTest(
      Effect.gen(function* () {
        const errorAssistant = arrange();
        const spy = spyAutoCompaction();
        yield* checkCompaction(errorAssistant);
        if (triggers) {
          expect(spy).toHaveBeenCalledWith("threshold", false);
        } else {
          expect(spy).not.toHaveBeenCalled();
        }
      }),
    ),
  );
});
