import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type modelTypesModule from "../../../../../libs/ai/src/model-types.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { cleanupAll } = harnessModule;

const { fauxAssistantMessage } = ai;

const { createHarness, getUserTexts } = harnessModule;

const { currentTimeMillis } = testing;

function createUsage(totalTokens: number) {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input: totalTokens,
    output: 0,
    totalTokens,
  };
}

const harnesses: harnessTypes.Harness[] = [];

const compactsLengthStopOverflowBeforeA = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            Promise.resolve({
              compaction: {
                details: {},
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                summary: "pre-prompt summary",
                tokensBefore: event.preparation.tokensBefore,
              },
            }),
          );
        },
      ],
      models: [{ contextWindow: 100, id: "faux-1", maxTokens: 100 }],
      settings: { compaction: { enabled: true, keepRecentTokens: 1, reserveTokens: 0 } },
    }),
  );
  harnesses.push(harness);
  const now = currentTimeMillis();
  const model = harness.getModel();
  harness.sessionManager.appendMessage({
    content: [{ text: "previous prompt", type: "text" }],
    role: "user",
    timestamp: now - 1000,
  });
  return yield* compactsLengthStopOverflowBeforeAStep1(harness, now, model);
});

const compactsLengthStopOverflowBeforeAStep1 = (
  harness: harnessTypes.Harness,
  now: number,
  model: modelTypesModule.Model<string>,
) =>
  Effect.gen(function* () {
    const lengthStopAssistant: aiTypes.AssistantMessage = {
      ...fauxAssistantMessage("length-stop assistant response", {
        stopReason: "length",
        timestamp: now - 500,
      }),
      api: model.api,
      model: model.id,
      provider: model.provider,
      usage: createUsage(100),
    };
    harness.sessionManager.appendMessage(lengthStopAssistant);
    harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
    harness.setResponses([fauxAssistantMessage("answered next prompt")]);
    const continueSpy = vi.spyOn(harness.session.agent, "continue");
    yield* Effect.promise(() =>
      expect(harness.session.run.prompting.prompt("next prompt")).resolves.toBeUndefined(),
    );
    expect(continueSpy).not.toHaveBeenCalled();
    expect(harness.eventsOfType("compaction_end").at(-1)).toMatchObject({
      aborted: false,
      reason: "overflow",
      willRetry: true,
    });
    expect(getUserTexts(harness)).toContain("next prompt");
    expect(harness.faux.state.callCount).toBe(1);
  });

const compactsLengthStopOverflowBeforeANew = () =>
  Effect.runPromise(compactsLengthStopOverflowBeforeA);

const afterEachHook = () => {
  vi.restoreAllMocks();
  return cleanupAll(harnesses);
};

describe("pre-prompt compaction regression", () => {
  afterEach(afterEachHook);
  it(
    "compacts length-stop overflow before a new prompt without continuing from an assistant message",
    compactsLengthStopOverflowBeforeANew,
  );
});
