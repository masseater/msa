import { Effect } from "effect";
import { afterEach, describe, it } from "vite-plus/test";

import closeAgentSessionModule from "../close-agent-session.ts";
import agentSessionBashPersistenceCases from "./agent-session-bash-persistence-cases.ts";

const { cleanupAll } = closeAgentSessionModule;

const {
  abortsAllActiveBashExecutions,
  cancelsRunningBashCommandsWithAbortbash,
  defersBashResultsWhileStreamingAnd,
  doesNotEmitMessageEndFor,
  doesNotHoldBackOutputBehind,
  executesBashCommandsAndRecordsThe,
  flushesAnIncompleteMultiByteCharacter,
  harnesses,
  keepsNewerBashExecutionTrackedWhen,
  persistsAbortedAssistantMessages,
  persistsUserAssistantToolresultAndCustom,
  recordsBashOutputThroughCustomOperations,
  recordsBashResultsImmediatelyWhileIdle,
  streamsBashOutputToTheCallback,
  stripsAColorCodeSplitRight,
  stripsAColorResetSplitInside,
  stripsAnOscSequenceSplitBefore,
} = agentSessionBashPersistenceCases;

const recordsBashResultsImmediatelyWhileIdle2 = () =>
  Effect.runPromise(recordsBashResultsImmediatelyWhileIdle);

const defersBashResultsWhileStreamingAndFlushes = () =>
  Effect.runPromise(defersBashResultsWhileStreamingAnd);

const executesBashCommandsAndRecordsTheResult = () =>
  Effect.runPromise(executesBashCommandsAndRecordsThe);

const cancelsRunningBashCommandsWithAbortbash2 = () =>
  Effect.runPromise(cancelsRunningBashCommandsWithAbortbash);

const keepsNewerBashExecutionTrackedWhenAn = () =>
  Effect.runPromise(keepsNewerBashExecutionTrackedWhen);

const abortsAllActiveBashExecutions2 = () => Effect.runPromise(abortsAllActiveBashExecutions);

const persistsUserAssistantToolresultAndCustomMessages = () =>
  Effect.runPromise(persistsUserAssistantToolresultAndCustom);

const doesNotEmitMessageEndForBash = () => Effect.runPromise(doesNotEmitMessageEndFor);

const persistsAbortedAssistantMessages2 = () => Effect.runPromise(persistsAbortedAssistantMessages);

const recordsBashOutputThroughCustomOperations2 = () =>
  Effect.runPromise(recordsBashOutputThroughCustomOperations);

const streamsBashOutputToTheCallbackAnd = () => Effect.runPromise(streamsBashOutputToTheCallback);

const stripsAColorResetSplitInsideIts = () => Effect.runPromise(stripsAColorResetSplitInside);

const stripsAColorCodeSplitRightAfter = () => Effect.runPromise(stripsAColorCodeSplitRight);

const stripsAnOscSequenceSplitBeforeIts = () => Effect.runPromise(stripsAnOscSequenceSplitBefore);

const flushesAnIncompleteMultiByteCharacterAt = () =>
  Effect.runPromise(flushesAnIncompleteMultiByteCharacter);

const doesNotHoldBackOutputBehindA = () => Effect.runPromise(doesNotHoldBackOutputBehind);

const afterEachHook = () => cleanupAll(harnesses);

describe("AgentSession bash and persistence characterization", () => {
  afterEach(afterEachHook);
  it("records bash results immediately while idle", recordsBashResultsImmediatelyWhileIdle2);
  it(
    "defers bash results while streaming and flushes them before the next prompt",
    defersBashResultsWhileStreamingAndFlushes,
  );
  it("executes bash commands and records the result", executesBashCommandsAndRecordsTheResult);
  it("cancels running bash commands with abortBash", cancelsRunningBashCommandsWithAbortbash2);
  it(
    "keeps newer bash execution tracked when an older execution finishes",
    keepsNewerBashExecutionTrackedWhenAn,
  );
  it("aborts all active bash executions", abortsAllActiveBashExecutions2);
  it(
    "persists user, assistant, toolResult, and custom messages in order",
    persistsUserAssistantToolresultAndCustomMessages,
  );
  it("does not emit message_end for bash execution messages", doesNotEmitMessageEndForBash);
  it("persists aborted assistant messages", persistsAbortedAssistantMessages2);
  it("records bash output through custom operations", recordsBashOutputThroughCustomOperations2);
  it("streams bash output to the callback and session events", streamsBashOutputToTheCallbackAnd);
  describe("escape sequences split across output chunks", () => {
    it("strips a color reset split inside its parameters", stripsAColorResetSplitInsideIts);
    it("strips a color code split right after ESC", stripsAColorCodeSplitRightAfter);
    it("strips an OSC sequence split before its terminator", stripsAnOscSequenceSplitBeforeIts);
    it(
      "flushes an incomplete multi-byte character at the end of output",
      flushesAnIncompleteMultiByteCharacterAt,
    );
    it(
      "does not hold back output behind a long unterminated sequence",
      doesNotHoldBackOutputBehindA,
    );
  });
});
