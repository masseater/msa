import agentSessionRetryEventsCases1 from "./agent-session-retry-events-cases-1.ts";
import agentSessionRetryEventsCases2 from "./agent-session-retry-events-cases-2.ts";
import agentSessionRetryEventsCases3 from "./agent-session-retry-events-cases-3.ts";

const agentSessionRetryEventsCases = {
  cancelsRetrySleepWhenAbortretryIs:
    agentSessionRetryEventsCases1.cancelsRetrySleepWhenAbortretryIs,
  doesNotRetryNonRetryableErrors: agentSessionRetryEventsCases1.doesNotRetryNonRetryableErrors,
  doesNotRetryWhenRetryIs: agentSessionRetryEventsCases1.doesNotRetryWhenRetryIs,
  emitsAgentEndForAbortedRuns: agentSessionRetryEventsCases3.emitsAgentEndForAbortedRuns,
  emitsAgentEndForErrorResponses: agentSessionRetryEventsCases2.emitsAgentEndForErrorResponses,
  emitsExtensionEventsBeforePublicEvent:
    agentSessionRetryEventsCases2.emitsExtensionEventsBeforePublicEvent,
  emitsStreamingDeltasForTextThinking:
    agentSessionRetryEventsCases2.emitsStreamingDeltasForTextThinking,
  emitsTheExpectedEventOrderFor: agentSessionRetryEventsCases2.emitsTheExpectedEventOrderFor,
  emitsTheExpectedEventOrderFor2: agentSessionRetryEventsCases2.emitsTheExpectedEventOrderFor2,
  exhaustsMaxRetriesAndEmitsA: agentSessionRetryEventsCases1.exhaustsMaxRetriesAndEmitsA,
  expectExtensionEventsFirst: agentSessionRetryEventsCases2.expectExtensionEventsFirst,
  expectToolTurnEventOrder: agentSessionRetryEventsCases2.expectToolTurnEventOrder,
  finalizesRetryStateWhenAbortIs: agentSessionRetryEventsCases1.finalizesRetryStateWhenAbortIs,
  harnesses: agentSessionRetryEventsCases1.harnesses,
  normalizeEventOrder: agentSessionRetryEventsCases1.normalizeEventOrder,
  promptWaitsForRetryCompletionEven:
    agentSessionRetryEventsCases1.promptWaitsForRetryCompletionEven,
  retriesAfterATransientErrorAnd: agentSessionRetryEventsCases1.retriesAfterATransientErrorAnd,
  retriesMultipleTransientFailuresAndSucceeds:
    agentSessionRetryEventsCases1.retriesMultipleTransientFailuresAndSucceeds,
  waitsForTheFullLoopWhen: agentSessionRetryEventsCases2.waitsForTheFullLoopWhen,
};

export default agentSessionRetryEventsCases;
