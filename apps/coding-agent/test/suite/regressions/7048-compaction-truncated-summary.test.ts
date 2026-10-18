import { type AssistantMessage, fauxAssistantMessage } from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { nowMillis } from "../../test-time.ts";
import { createHarness, type Harness } from "../harness.ts";

function seedCompactableSession(harness: Harness): void {
  harness.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
  const now = nowMillis();
  harness.sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "message to compact" }],
    timestamp: now - 1000,
  });
  const model = harness.getModel();
  const assistant: AssistantMessage = {
    ...fauxAssistantMessage("assistant response to compact", { timestamp: now - 500 }),
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 100,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 100,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  harness.sessionManager.appendMessage(assistant);
  harness.session.agent.state.messages = harness.sessionManager.buildSessionContext().messages;
}

let harness!: Harness;

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

describe("#7048 truncated compaction summaries", () => {
  afterEach(() => {
    harness?.cleanup();
  });
  it("does not persist a length-limited summary", () =>
    Effect.runPromise(doesNotPersistALengthLimited));
});
