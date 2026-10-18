import { fauxAssistantMessage } from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { toJsonEvent } from "../../../src/modes/json-event.ts";
import { createHarness, type Harness } from "../harness.ts";

let harness!: Harness;

const includesCumulativeUsageWithoutCumulativeMessage = Effect.gen(function* () {
  harness = yield* Effect.promise(() => createHarness());
  harness.setResponses([fauxAssistantMessage("hello")]);

  yield* Effect.promise(() => harness.session.prompt("respond"));

  const update = harness
    .eventsOfType("message_update")
    .find((event) => event.message.role === "assistant" && event.message.usage.totalTokens > 0);
  if (update === undefined || update.message.role !== "assistant") {
    throw new Error("Expected an assistant update with populated usage");
  }

  const wireUpdate = toJsonEvent(update);
  expect(wireUpdate.usage).toEqual(update.message.usage);
  expect(wireUpdate).not.toHaveProperty("message");
  expect(wireUpdate.assistantMessageEvent).not.toHaveProperty("partial");
});

describe("regression #7911: JSON message updates retain usage", () => {
  afterEach(() => {
    harness?.cleanup();
  });
  it("includes cumulative usage without cumulative message snapshots", () =>
    Effect.runPromise(includesCumulativeUsageWithoutCumulativeMessage));
});
