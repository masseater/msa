import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import agentSessionBoundariesSupport from "./agent-session-boundaries-support.ts";
import harnessModule from "./harness.ts";

const { cleanupAll } = harnessModule;

const { fauxAssistantMessage } = ai;

const { harnesses } = agentSessionBoundariesSupport;

const { createHarness } = harnessModule;

const { currentTimeMillis } = testing;

const doesNotTriggerThresholdCompactionFrom = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ contextWindow: 10_000, id: "faux-1", maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
    }),
  );
  harnesses.push(harness);
  const userId = harness.sessionManager.appendMessage({
    content: "small input",
    role: "user",
    timestamp: currentTimeMillis() - 3,
  });
  harness.sessionManager.appendContextEdit(userId, { content: "edited input" });
  const response = fauxAssistantMessage("answer", { timestamp: currentTimeMillis() - 2 });
  response.usage = { ...response.usage, input: 50_000, output: 1, totalTokens: 50_001 };
  harness.sessionManager.appendMessage(response);
  harness.sessionManager.appendCompaction("small summary", userId, 50_001);
  harness.session.refreshContext();
  const autoCompaction = harness.session.compaction.auto;
  const runAutoCompaction = vi.spyOn(autoCompaction, "runAutoCompaction");
  const checkCompaction = autoCompaction.checkCompaction.bind(autoCompaction);
  const error = fauxAssistantMessage("", {
    errorMessage: "invalid_api_key",
    stopReason: "error",
    timestamp: currentTimeMillis() + 1_000,
  });

  yield* Effect.promise(() => checkCompaction(error));

  expect(runAutoCompaction).not.toHaveBeenCalled();
});

const doesNotTreatRetainedPreCompaction = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  const retained = fauxAssistantMessage("retained");
  retained.usage = { ...retained.usage, input: 10_000, totalTokens: 10_001 };
  const retainedId = harness.sessionManager.appendMessage(retained);
  harness.sessionManager.appendCompaction("summary", retainedId, 10_001);
  harness.session.refreshContext();

  expect(harness.session.context.stats.getContextUsage()?.tokens).toBeNull();
});

const persistsCustomContextSentDuringPre = Effect.gen(function* () {
  let handled = false;
  const requests: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("agent_before_settle", () => {
            if (handled) return;
            handled = true;
            msa.sendMessage(
              {
                content: "persist before continue",
                customType: "pending-boundary",
                display: false,
              },
              { triggerTurn: false },
            );
            return { continue: true };
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("first"),
    (context) => {
      requests.push(JSON.stringify(context.messages));
      return fauxAssistantMessage("second");
    },
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("start"));

  expect(harness.faux.state.callCount).toBe(2);
  expect(requests[0]).toContain("persist before continue");
  expect(harness.sessionManager.getEntries()).toContainEqual(
    expect.objectContaining({ customType: "pending-boundary", type: "custom_message" }),
  );
});

const doesNotTriggerThresholdCompactionFromPost = () =>
  Effect.runPromise(doesNotTriggerThresholdCompactionFrom);

const doesNotTreatRetainedPreCompactionAssistant = () =>
  Effect.runPromise(doesNotTreatRetainedPreCompaction);

const persistsCustomContextSentDuringPreSettlement = () =>
  Effect.runPromise(persistsCustomContextSentDuringPre);

describe("AgentSession actionable boundaries", () => {
  afterEach(() => cleanupAll(harnesses));

  it(
    "does not trigger threshold compaction from post-edit usage captured before a later compaction",
    doesNotTriggerThresholdCompactionFromPost,
  );

  it(
    "does not treat retained pre-compaction assistant usage as post-compaction usage",
    doesNotTreatRetainedPreCompactionAssistant,
  );
});

describe("AgentSession actionable boundaries", () => {
  afterEach(() => cleanupAll(harnesses));

  it(
    "persists custom context sent during pre-settlement before continuing",
    persistsCustomContextSentDuringPreSettlement,
  );
});
