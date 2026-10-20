import ai from "@msa/ai";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { fauxAssistantMessage } = ai;

const { createHarness, getAssistantTexts } = harnessModule;

const harnesses: harnessTypes.Harness[] = [];

const retriesTransientNetworkConnectionLostFailures = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage("", {
      errorMessage: "Network connection lost.",
      stopReason: "error",
    }),
    fauxAssistantMessage("recovered after reconnect"),
  ]);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("test"));

  expect(harness.faux.state.callCount).toBe(2);
  expect(harness.eventsOfType("auto_retry_start").map((event) => event.errorMessage)).toEqual([
    "Network connection lost.",
  ]);
  expect(harness.eventsOfType("auto_retry_end").map((event) => event.success)).toEqual([true]);
  expect(getAssistantTexts(harness)).toContain("recovered after reconnect");
});

const retriesTransientNetworkConnectionLostFailures2 = () =>
  Effect.runPromise(retriesTransientNetworkConnectionLostFailures);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("issue #3317 network connection lost retry", () => {
  afterEach(afterEachHook);
  it(
    'retries transient "Network connection lost." failures',
    retriesTransientNetworkConnectionLostFailures2,
  );
});
