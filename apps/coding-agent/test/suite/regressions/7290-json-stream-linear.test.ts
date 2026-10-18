import { fauxAssistantMessage } from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { toJsonEvent } from "../../../src/modes/json-event.ts";
import { createHarness, type Harness } from "../harness.ts";

const harnesses: Harness[] = [];

function measureUpdateBytes(text: string): Promise<number> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => createHarness());
      harnesses.push(harness);
      harness.setResponses([fauxAssistantMessage(text)]);

      yield* Effect.promise(() => harness.session.prompt("respond"));

      const sessionUpdates = harness.eventsOfType("message_update");
      for (const update of sessionUpdates) {
        expect(update).toHaveProperty("message");
        expect(update.assistantMessageEvent).toHaveProperty("partial");
      }

      const updates = sessionUpdates.map((event) => toJsonEvent(event));
      expect(updates.length).toBeGreaterThan(0);
      for (const update of updates) {
        expect(update).not.toHaveProperty("message");
        expect(update.assistantMessageEvent).not.toHaveProperty("partial");
      }
      return updates.reduce((bytes, event) => bytes + Buffer.byteLength(JSON.stringify(event)), 0);
    }),
  );
}

const emitsDeltaOnlyMessageUpdatesWhose = Effect.gen(function* () {
  const smallBytes = yield* Effect.promise(() => measureUpdateBytes("x".repeat(2_000)));
  const largeBytes = yield* Effect.promise(() => measureUpdateBytes("x".repeat(4_000)));

  expect(largeBytes).toBeGreaterThan(smallBytes);
  expect(largeBytes / smallBytes).toBeLessThan(2.2);
});

describe("regression #7290: JSON event streams stay linear", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("emits delta-only message updates whose size scales linearly", () =>
    Effect.runPromise(emitsDeltaOnlyMessageUpdatesWhose));
});
