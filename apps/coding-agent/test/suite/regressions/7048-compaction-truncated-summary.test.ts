import { type AssistantMessage, fauxAssistantMessage } from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;

const { currentTimeMillis } = testing;

function seedCompactableSession(harness: harnessTypes.Harness): void {
  harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
  const now = currentTimeMillis();
  harness.sessionManager.appendMessage({
    content: [{ text: "message to compact", type: "text" }],
    role: "user",
    timestamp: now - 1000,
  });
  const model = harness.getModel();
  const assistant: AssistantMessage = {
    ...fauxAssistantMessage("assistant response to compact", { timestamp: now - 500 }),
    api: model.api,
    model: model.id,
    provider: model.provider,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 100,
      output: 0,
      totalTokens: 100,
    },
  };
  harness.sessionManager.appendMessage(assistant);
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

let harness!: harnessTypes.Harness;

const doesNotPersistALengthLimited = Effect.gen(function* () {
  harness = yield* Effect.promise(() => createHarness());
  seedCompactableSession(harness);
  harness.setResponses([fauxAssistantMessage("partial summar", { stopReason: "length" })]);

  yield* Effect.promise(() =>
    expect(harness.session.compact()).rejects.toThrow("generation hit the token cap"),
  );
  expect(
    harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction"),
  ).toHaveLength(0);
});

const doesNotPersistALengthLimitedSummary = () => Effect.runPromise(doesNotPersistALengthLimited);

describe("#7048 truncated compaction summaries", () => {
  afterEach(() => {
    harness?.cleanup();
  });
  it("does not persist a length-limited summary", doesNotPersistALengthLimitedSummary);
});
