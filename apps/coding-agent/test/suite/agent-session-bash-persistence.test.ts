import { Effect } from "effect";
import { afterEach, describe, it } from "vite-plus/test";

import {
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
} from "./agent-session-bash-persistence-cases.ts";

describe("AgentSession bash and persistence characterization", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("records bash results immediately while idle", () =>
    Effect.runPromise(recordsBashResultsImmediatelyWhileIdle));
  it("defers bash results while streaming and flushes them before the next prompt", () =>
    Effect.runPromise(defersBashResultsWhileStreamingAnd));
  it("executes bash commands and records the result", () =>
    Effect.runPromise(executesBashCommandsAndRecordsThe));
  it("cancels running bash commands with abortBash", () =>
    Effect.runPromise(cancelsRunningBashCommandsWithAbortbash));
  it("keeps newer bash execution tracked when an older execution finishes", () =>
    Effect.runPromise(keepsNewerBashExecutionTrackedWhen));
  it("aborts all active bash executions", () => Effect.runPromise(abortsAllActiveBashExecutions));
  it("persists user, assistant, toolResult, and custom messages in order", () =>
    Effect.runPromise(persistsUserAssistantToolresultAndCustom));
  it("does not emit message_end for bash execution messages", () =>
    Effect.runPromise(doesNotEmitMessageEndFor));
  it("persists aborted assistant messages", () =>
    Effect.runPromise(persistsAbortedAssistantMessages));
  it("records bash output through custom operations", () =>
    Effect.runPromise(recordsBashOutputThroughCustomOperations));
  it("streams bash output to the callback and session events", () =>
    Effect.runPromise(streamsBashOutputToTheCallback));
  describe("escape sequences split across output chunks", () => {
    it("strips a color reset split inside its parameters", () =>
      Effect.runPromise(stripsAColorResetSplitInside));
    it("strips a color code split right after ESC", () =>
      Effect.runPromise(stripsAColorCodeSplitRight));
    it("strips an OSC sequence split before its terminator", () =>
      Effect.runPromise(stripsAnOscSequenceSplitBefore));
    it("flushes an incomplete multi-byte character at the end of output", () =>
      Effect.runPromise(flushesAnIncompleteMultiByteCharacter));
    it("does not hold back output behind a long unterminated sequence", () =>
      Effect.runPromise(doesNotHoldBackOutputBehind));
  });
});
