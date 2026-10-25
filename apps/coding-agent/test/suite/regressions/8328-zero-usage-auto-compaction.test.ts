import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { cleanupAll } = harnessModule;

const { createHarness } = harnessModule;

const { currentTimeMillis } = testing;

function createZeroUsageAssistant(harness: harnessTypes.Harness): aiTypes.AssistantMessage {
  const model = harness.getModel();
  return {
    api: model.api,
    content: [{ text: "response", type: "text" }],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

const harnesses: harnessTypes.Harness[] = [];

function createCompactionHarness(): Promise<harnessTypes.Harness> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() =>
        createHarness({
          models: [{ contextWindow: 100, id: "faux-1", maxTokens: 20 }],
          settings: { compaction: { enabled: true, reserveTokens: 10 } },
        }),
      );
      harnesses.push(harness);
      return harness;
    }),
  );
}

const usesTheMessageEstimateWhenNo = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createCompactionHarness());
  const assistant = createZeroUsageAssistant(harness);
  harness.session.agent.state.messages = [
    {
      content: [{ text: "x".repeat(400), type: "text" }],
      role: "user",
      timestamp: currentTimeMillis() - 1,
    },
    assistant,
  ];
  const sessionInternals = harness.session.compaction.auto;
  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "runAutoCompaction")
    .mockResolvedValue(false);

  yield* Effect.promise(() => sessionInternals["checkCompaction"](assistant));

  expect(runAutoCompactionSpy).toHaveBeenCalledOnce();
  expect(runAutoCompactionSpy).toHaveBeenCalledWith("threshold", false);
});

const doesNotCompactWhenTheZero = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createCompactionHarness());
  const assistant = createZeroUsageAssistant(harness);
  harness.session.agent.state.messages = [
    {
      content: [{ text: "short", type: "text" }],
      role: "user",
      timestamp: currentTimeMillis() - 1,
    },
    assistant,
  ];
  const sessionInternals = harness.session.compaction.auto;
  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "runAutoCompaction")
    .mockResolvedValue(false);

  yield* Effect.promise(() => sessionInternals["checkCompaction"](assistant));

  expect(runAutoCompactionSpy).not.toHaveBeenCalled();
});

const usesTheMessageEstimateWhenNoAssistant = () => Effect.runPromise(usesTheMessageEstimateWhenNo);

const doesNotCompactWhenTheZeroUsage = () => Effect.runPromise(doesNotCompactWhenTheZero);

const afterEachHook = () => {
  vi.restoreAllMocks();
  return cleanupAll(harnesses);
};

describe("issue #8328 zero-usage auto-compaction", () => {
  afterEach(afterEachHook);
  it(
    "uses the message estimate when no assistant has reported usage",
    usesTheMessageEstimateWhenNoAssistant,
  );
  it(
    "does not compact when the zero-usage message estimate is below the threshold",
    doesNotCompactWhenTheZeroUsage,
  );
});
