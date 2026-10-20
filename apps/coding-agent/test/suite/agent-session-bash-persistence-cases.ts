import agentSessionBashPersistenceCases1 from "./agent-session-bash-persistence-cases-1.ts";
import agentSessionBashPersistenceCases2 from "./agent-session-bash-persistence-cases-2.ts";
import agentSessionBashPersistenceCases3 from "./agent-session-bash-persistence-cases-3.ts";
import agentSessionBashPersistenceCases4 from "./agent-session-bash-persistence-cases-4.ts";
import agentSessionBashPersistenceCases5 from "./agent-session-bash-persistence-cases-5.ts";
import agentSessionBashPersistenceCases6 from "./agent-session-bash-persistence-cases-6.ts";

const agentSessionBashPersistenceCases = {
  abortsAllActiveBashExecutions: agentSessionBashPersistenceCases3.abortsAllActiveBashExecutions,
  cancelsRunningBashCommandsWithAbortbash:
    agentSessionBashPersistenceCases3.cancelsRunningBashCommandsWithAbortbash,
  createControlledBashOperations: agentSessionBashPersistenceCases1.createControlledBashOperations,
  defersBashResultsWhileStreamingAnd:
    agentSessionBashPersistenceCases2.defersBashResultsWhileStreamingAnd,
  doesNotEmitMessageEndFor: agentSessionBashPersistenceCases4.doesNotEmitMessageEndFor,
  doesNotHoldBackOutputBehind: agentSessionBashPersistenceCases6.doesNotHoldBackOutputBehind,
  executesBashCommandsAndRecordsThe:
    agentSessionBashPersistenceCases3.executesBashCommandsAndRecordsThe,
  flushesAnIncompleteMultiByteCharacter:
    agentSessionBashPersistenceCases6.flushesAnIncompleteMultiByteCharacter,
  getEntryTypes: agentSessionBashPersistenceCases1.getEntryTypes,
  harnesses: agentSessionBashPersistenceCases1.harnesses,
  keepsNewerBashExecutionTrackedWhen:
    agentSessionBashPersistenceCases3.keepsNewerBashExecutionTrackedWhen,
  persistsAbortedAssistantMessages:
    agentSessionBashPersistenceCases5.persistsAbortedAssistantMessages,
  persistsUserAssistantToolresultAndCustom:
    agentSessionBashPersistenceCases4.persistsUserAssistantToolresultAndCustom,
  persistsUserAssistantToolresultAndCustomPart2:
    agentSessionBashPersistenceCases3.persistsUserAssistantToolresultAndCustomPart2,
  recordsBashOutputThroughCustomOperations:
    agentSessionBashPersistenceCases6.recordsBashOutputThroughCustomOperations,
  recordsBashResultsImmediatelyWhileIdle:
    agentSessionBashPersistenceCases1.recordsBashResultsImmediatelyWhileIdle,
  runChunks: agentSessionBashPersistenceCases6.runChunks,
  streamsBashOutputToTheCallback: agentSessionBashPersistenceCases6.streamsBashOutputToTheCallback,
  stripsAColorCodeSplitRight: agentSessionBashPersistenceCases6.stripsAColorCodeSplitRight,
  stripsAColorResetSplitInside: agentSessionBashPersistenceCases6.stripsAColorResetSplitInside,
  stripsAnOscSequenceSplitBefore: agentSessionBashPersistenceCases6.stripsAnOscSequenceSplitBefore,
};

export default agentSessionBashPersistenceCases;
