import type { AssistantMessage } from "@msa/ai";
import { currentTimeMillis } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createHarness, type Harness } from "../harness.ts";

type SessionWithCompactionInternals = {
  checkCompaction: (assistantMessage: AssistantMessage) => Promise<boolean>;
  runAutoCompaction: (reason: "overflow" | "threshold", willRetry: boolean) => Promise<boolean>;
};

function createZeroUsageAssistant(harness: Harness): AssistantMessage {
  const model = harness.getModel();
  return {
    role: "assistant",
    content: [{ type: "text", text: "response" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: currentTimeMillis(),
  };
}

const harnesses: Harness[] = [];

function createCompactionHarness(): Promise<Harness> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() =>
        createHarness({
          models: [{ id: "faux-1", contextWindow: 100, maxTokens: 20 }],
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
      role: "user",
      content: [{ type: "text", text: "x".repeat(400) }],
      timestamp: currentTimeMillis() - 1,
    },
    assistant,
  ];
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
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
      role: "user",
      content: [{ type: "text", text: "short" }],
      timestamp: currentTimeMillis() - 1,
    },
    assistant,
  ];
  const sessionInternals = harness.session as unknown as SessionWithCompactionInternals;
  const runAutoCompactionSpy = vi
    .spyOn(sessionInternals, "runAutoCompaction")
    .mockResolvedValue(false);

  yield* Effect.promise(() => sessionInternals["checkCompaction"](assistant));

  expect(runAutoCompactionSpy).not.toHaveBeenCalled();
});

describe("issue #8328 zero-usage auto-compaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("uses the message estimate when no assistant has reported usage", () =>
    Effect.runPromise(usesTheMessageEstimateWhenNo));
  it("does not compact when the zero-usage message estimate is below the threshold", () =>
    Effect.runPromise(doesNotCompactWhenTheZero));
});
