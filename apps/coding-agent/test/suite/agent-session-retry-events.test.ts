import { Effect } from "effect";
import { afterEach, describe, it } from "vite-plus/test";

import agentSessionRetryEventsCases from "./agent-session-retry-events-cases.ts";

const {
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
} = agentSessionRetryEventsCases;

const retriesAfterATransientErrorAndSucceeds = () =>
  Effect.runPromise(retriesAfterATransientErrorAnd);

const retriesMultipleTransientFailuresAndSucceedsOn = () =>
  Effect.runPromise(retriesMultipleTransientFailuresAndSucceeds);

const finalizesRetryStateWhenAbortIsRequested = () =>
  Effect.runPromise(finalizesRetryStateWhenAbortIs);

const exhaustsMaxRetriesAndEmitsAFailure = () => Effect.runPromise(exhaustsMaxRetriesAndEmitsA);

const promptWaitsForRetryCompletionEvenWhen = () =>
  Effect.runPromise(promptWaitsForRetryCompletionEven);

const doesNotRetryWhenRetryIsDisabled = () => Effect.runPromise(doesNotRetryWhenRetryIs);

const doesNotRetryNonRetryableErrors2 = () => Effect.runPromise(doesNotRetryNonRetryableErrors);

const cancelsRetrySleepWhenAbortretryIsCalled = () =>
  Effect.runPromise(cancelsRetrySleepWhenAbortretryIs);

const waitsForTheFullLoopWhenRetry = () => Effect.runPromise(waitsForTheFullLoopWhen);

const emitsExtensionEventsBeforePublicEventSubscribers = () =>
  Effect.runPromise(emitsExtensionEventsBeforePublicEvent);

const emitsTheExpectedEventOrderForA = () => Effect.runPromise(emitsTheExpectedEventOrderFor);

const emitsTheExpectedEventOrderForA2 = () => Effect.runPromise(emitsTheExpectedEventOrderFor2);

const emitsStreamingDeltasForTextThinkingAnd = () =>
  Effect.runPromise(emitsStreamingDeltasForTextThinking);

const emitsAgentEndForErrorResponses2 = () => Effect.runPromise(emitsAgentEndForErrorResponses);

const emitsAgentEndForAbortedRunsAnd = () => Effect.runPromise(emitsAgentEndForAbortedRuns);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("AgentSession retry and event characterization", () => {
  afterEach(afterEachHook);
  it("retries after a transient error and succeeds", retriesAfterATransientErrorAndSucceeds);
  it(
    "retries multiple transient failures and succeeds on the final attempt",
    retriesMultipleTransientFailuresAndSucceedsOn,
  );
  it(
    "finalizes retry state when abort is requested after a retry attempt fails",
    finalizesRetryStateWhenAbortIsRequested,
  );
  it("exhausts max retries and emits a failure event", exhaustsMaxRetriesAndEmitsAFailure);
  it(
    "prompt waits for retry completion even when assistant message_end handling is delayed",
    promptWaitsForRetryCompletionEvenWhen,
  );
  it("does not retry when retry is disabled", doesNotRetryWhenRetryIsDisabled);
  it("does not retry non-retryable errors", doesNotRetryNonRetryableErrors2);
  it("cancels retry sleep when abortRetry is called", cancelsRetrySleepWhenAbortretryIsCalled);
  it(
    "waits for the full loop when retry recovery produces tool calls",
    waitsForTheFullLoopWhenRetry,
  );
  it(
    "emits extension events before public event subscribers",
    emitsExtensionEventsBeforePublicEventSubscribers,
  );
  it("emits the expected event order for a single prompt", emitsTheExpectedEventOrderForA);
  it("emits the expected event order for a tool call turn", emitsTheExpectedEventOrderForA2);
  it(
    "emits streaming deltas for text, thinking, and tool calls in message_update events",
    emitsStreamingDeltasForTextThinkingAnd,
  );
  it("emits agent_end for error responses", emitsAgentEndForErrorResponses2);
  it(
    "emits agent_end for aborted runs and persists the aborted assistant message",
    emitsAgentEndForAbortedRunsAnd,
  );
});
