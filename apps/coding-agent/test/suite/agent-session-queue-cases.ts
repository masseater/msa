import agentSessionQueueCases1 from "./agent-session-queue-cases-1.ts";
import agentSessionQueueCases2 from "./agent-session-queue-cases-2.ts";
import agentSessionQueueCases3 from "./agent-session-queue-cases-3.ts";
import agentSessionQueueCases4 from "./agent-session-queue-cases-4.ts";

const agentSessionQueueCases = {
  createWaitingHarness: agentSessionQueueCases1.createWaitingHarness,
  deliversAllFollowUpMessagesIn: agentSessionQueueCases3.deliversAllFollowUpMessagesIn,
  deliversAllSteeringMessagesInOne: agentSessionQueueCases2.deliversAllSteeringMessagesInOne,
  deliversExtensionOriginSteeringMessagesBefore:
    agentSessionQueueCases2.deliversExtensionOriginSteeringMessagesBefore,
  deliversFollowUpMessagesOnlyAfter: agentSessionQueueCases2.deliversFollowUpMessagesOnlyAfter,
  deliversFollowUpsQueuedDuringAgent: agentSessionQueueCases4.deliversFollowUpsQueuedDuringAgent,
  deliversMultipleFollowUpMessagesIn: agentSessionQueueCases2.deliversMultipleFollowUpMessagesIn,
  deliversMultipleSteeringMessagesInOrder:
    agentSessionQueueCases2.deliversMultipleSteeringMessagesInOrder,
  dispatchesExtensionCommandsImmediatelyWhenPrompted:
    agentSessionQueueCases2.dispatchesExtensionCommandsImmediatelyWhenPrompted,
  harnesses: agentSessionQueueCases1.harnesses,
  injectsNextturnCustomMessagesIntoThe:
    agentSessionQueueCases3.injectsNextturnCustomMessagesIntoThe,
  queuesCustomMessagesWithDeliverasFollowup:
    agentSessionQueueCases3.queuesCustomMessagesWithDeliverasFollowup,
  queuesCustomMessagesWithDeliverasSteer:
    agentSessionQueueCases3.queuesCustomMessagesWithDeliverasSteer,
  runsDirectSteeringAndFollowUp: agentSessionQueueCases2.runsDirectSteeringAndFollowUp,
  throwsWhenQueueingAnExtensionCommand:
    agentSessionQueueCases3.throwsWhenQueueingAnExtensionCommand,
  throwsWhenQueueingAnExtensionCommand2:
    agentSessionQueueCases3.throwsWhenQueueingAnExtensionCommand2,
  updatesPendingmessagecountAndRemovesQueuedText:
    agentSessionQueueCases3.updatesPendingmessagecountAndRemovesQueuedText,
};

export default agentSessionQueueCases;
