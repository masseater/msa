import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import jsonEvent from "../../../src/modes/json-event.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { toJsonEvent } = jsonEvent;

const { fauxAssistantMessage } = ai;

const { createHarness } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];

function measureUpdateBytes(text: string): Promise<number> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => createHarness());
      harnesses.push(harness);
      harness.setResponses([fauxAssistantMessage(text)]);

      yield* Effect.promise(() => harness.session.run.prompting.prompt("respond"));

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

const emitsDeltaOnlyMessageUpdatesWhoseSize = () =>
  Effect.runPromise(emitsDeltaOnlyMessageUpdatesWhose);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("regression #7290: JSON event streams stay linear", () => {
  afterEach(afterEachHook);
  it(
    "emits delta-only message updates whose size scales linearly",
    emitsDeltaOnlyMessageUpdatesWhoseSize,
  );
});
