import ai from "@msa/ai";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import harnessModule from "../harness.ts";

const { fauxAssistantMessage } = ai;

const { createHarness } = harnessModule;

const wrappedDnsLookupError =
  "The pending stream has been canceled (caused by: getaddrinfo ENOTFOUND bedrock-runtime.us-east-1.amazonaws.com)";

const retriesATransientDnsLookupFailure = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { retry: { baseDelayMs: 1, enabled: true, maxRetries: 3 } },
    }),
  );
  try {
    harness.setResponses([
      fauxAssistantMessage("", { errorMessage: wrappedDnsLookupError, stopReason: "error" }),
      fauxAssistantMessage("recovered after DNS retry"),
    ]);

    yield* Effect.promise(() => harness.session.prompt("test"));

    expect(harness.faux.state.callCount).toBe(2);
    expect(harness.eventsOfType("auto_retry_start").map((event) => event.errorMessage)).toEqual([
      wrappedDnsLookupError,
    ]);
    expect(harness.eventsOfType("auto_retry_end").map((event) => event.success)).toEqual([true]);
  } finally {
    harness.cleanup();
  }
});

const retriesATransientDnsLookupFailure2 = () =>
  Effect.runPromise(retriesATransientDnsLookupFailure);

describe("issue #6904 DNS transport failure retry", () => {
  it("retries a transient DNS lookup failure", retriesATransientDnsLookupFailure2);
});
