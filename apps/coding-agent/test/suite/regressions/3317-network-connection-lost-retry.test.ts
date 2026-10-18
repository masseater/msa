import { fauxAssistantMessage } from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createHarness, getAssistantTexts, type Harness } from "../harness.ts";

const harnesses: Harness[] = [];

const retriesTransientNetworkConnectionLostFailures = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: "Network connection lost.",
    }),
    fauxAssistantMessage("recovered after reconnect"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("test"));

  expect(harness.faux.state.callCount).toBe(2);
  expect(harness.eventsOfType("auto_retry_start").map((event) => event.errorMessage)).toEqual([
    "Network connection lost.",
  ]);
  expect(harness.eventsOfType("auto_retry_end").map((event) => event.success)).toEqual([true]);
  expect(getAssistantTexts(harness)).toContain("recovered after reconnect");
});

describe("issue #3317 network connection lost retry", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it('retries transient "Network connection lost." failures', () =>
    Effect.runPromise(retriesTransientNetworkConnectionLostFailures));
});
