import { Effect } from "effect";
import { afterEach, describe, it } from "vite-plus/test";

import {
  cancelsRetrySleepWhenAbortretryIs,
  doesNotRetryNonRetryableErrors,
  doesNotRetryWhenRetryIs,
  emitsAgentEndForAbortedRuns,
  emitsAgentEndForErrorResponses,
  emitsExtensionEventsBeforePublicEvent,
  emitsStreamingDeltasForTextThinking,
  emitsTheExpectedEventOrderFor,
  emitsTheExpectedEventOrderFor2,
  exhaustsMaxRetriesAndEmitsA,
  finalizesRetryStateWhenAbortIs,
  harnesses,
  promptWaitsForRetryCompletionEven,
  retriesAfterATransientErrorAnd,
  retriesMultipleTransientFailuresAndSucceeds,
  waitsForTheFullLoopWhen,
} from "./agent-session-retry-events-cases.ts";

describe("AgentSession retry and event characterization", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("retries after a transient error and succeeds", () =>
    Effect.runPromise(retriesAfterATransientErrorAnd));
  it("retries multiple transient failures and succeeds on the final attempt", () =>
    Effect.runPromise(retriesMultipleTransientFailuresAndSucceeds));
  it("finalizes retry state when abort is requested after a retry attempt fails", () =>
    Effect.runPromise(finalizesRetryStateWhenAbortIs));
  it("exhausts max retries and emits a failure event", () =>
    Effect.runPromise(exhaustsMaxRetriesAndEmitsA));
  it("prompt waits for retry completion even when assistant message_end handling is delayed", () =>
    Effect.runPromise(promptWaitsForRetryCompletionEven));
  it("does not retry when retry is disabled", () => Effect.runPromise(doesNotRetryWhenRetryIs));
  it("does not retry non-retryable errors", () =>
    Effect.runPromise(doesNotRetryNonRetryableErrors));
  it("cancels retry sleep when abortRetry is called", () =>
    Effect.runPromise(cancelsRetrySleepWhenAbortretryIs));
  it("waits for the full loop when retry recovery produces tool calls", () =>
    Effect.runPromise(waitsForTheFullLoopWhen));
  it("emits extension events before public event subscribers", () =>
    Effect.runPromise(emitsExtensionEventsBeforePublicEvent));
  it("emits the expected event order for a single prompt", () =>
    Effect.runPromise(emitsTheExpectedEventOrderFor));
  it("emits the expected event order for a tool call turn", () =>
    Effect.runPromise(emitsTheExpectedEventOrderFor2));
  it("emits streaming deltas for text, thinking, and tool calls in message_update events", () =>
    Effect.runPromise(emitsStreamingDeltasForTextThinking));
  it("emits agent_end for error responses", () =>
    Effect.runPromise(emitsAgentEndForErrorResponses));
  it("emits agent_end for aborted runs and persists the aborted assistant message", () =>
    Effect.runPromise(emitsAgentEndForAbortedRuns));
});
