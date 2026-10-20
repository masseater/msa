import { Effect } from "effect";
import { afterEach, describe, it } from "vite-plus/test";

import agentSessionQueueCases from "./agent-session-queue-cases.ts";

const {
  deliversAllFollowUpMessagesIn,
  deliversAllSteeringMessagesInOne,
  deliversExtensionOriginSteeringMessagesBefore,
  deliversFollowUpMessagesOnlyAfter,
  deliversFollowUpsQueuedDuringAgent,
  deliversMultipleFollowUpMessagesIn,
  deliversMultipleSteeringMessagesInOrder,
  dispatchesExtensionCommandsImmediatelyWhenPrompted,
  harnesses,
  injectsNextturnCustomMessagesIntoThe,
  queuesCustomMessagesWithDeliverasFollowup,
  queuesCustomMessagesWithDeliverasSteer,
  runsDirectSteeringAndFollowUp,
  throwsWhenQueueingAnExtensionCommand,
  throwsWhenQueueingAnExtensionCommand2,
  updatesPendingmessagecountAndRemovesQueuedText,
} = agentSessionQueueCases;

const dispatchesExtensionCommandsImmediatelyWhenPromptedWhile = () =>
  Effect.runPromise(dispatchesExtensionCommandsImmediatelyWhenPrompted);

const deliversExtensionOriginSteeringMessagesBeforeThe = () =>
  Effect.runPromise(deliversExtensionOriginSteeringMessagesBefore);

const deliversFollowUpMessagesOnlyAfterThe = () =>
  Effect.runPromise(deliversFollowUpMessagesOnlyAfter);

const runsDirectSteeringAndFollowUpMessages = () =>
  Effect.runPromise(runsDirectSteeringAndFollowUp);

const deliversMultipleSteeringMessagesInOrderIn = () =>
  Effect.runPromise(deliversMultipleSteeringMessagesInOrder);

const deliversMultipleFollowUpMessagesInOrder = () =>
  Effect.runPromise(deliversMultipleFollowUpMessagesIn);

const deliversAllSteeringMessagesInOneBatch = () =>
  Effect.runPromise(deliversAllSteeringMessagesInOne);

const deliversAllFollowUpMessagesInOne = () => Effect.runPromise(deliversAllFollowUpMessagesIn);

const queuesCustomMessagesWithDeliverasSteerWhile = () =>
  Effect.runPromise(queuesCustomMessagesWithDeliverasSteer);

const queuesCustomMessagesWithDeliverasFollowupWhile = () =>
  Effect.runPromise(queuesCustomMessagesWithDeliverasFollowup);

const injectsNextturnCustomMessagesIntoTheNext = () =>
  Effect.runPromise(injectsNextturnCustomMessagesIntoThe);

const updatesPendingmessagecountAndRemovesQueuedTextBefore = () =>
  Effect.runPromise(updatesPendingmessagecountAndRemovesQueuedText);

const throwsWhenQueueingAnExtensionCommandWith = () =>
  Effect.runPromise(throwsWhenQueueingAnExtensionCommand);

const throwsWhenQueueingAnExtensionCommandWith2 = () =>
  Effect.runPromise(throwsWhenQueueingAnExtensionCommand2);

const deliversFollowUpsQueuedDuringAgentEnd = () =>
  Effect.runPromise(deliversFollowUpsQueuedDuringAgent);

const afterEachHook = () => {
  while (harnesses.length > 0) {
    harnesses.pop()?.cleanup();
  }
};

describe("AgentSession queue characterization", () => {
  afterEach(afterEachHook);

  it(
    "dispatches extension commands immediately when prompted while idle",
    dispatchesExtensionCommandsImmediatelyWhenPromptedWhile,
  );

  it(
    "delivers extension-origin steering messages before the next LLM call",
    deliversExtensionOriginSteeringMessagesBeforeThe,
  );

  it(
    "delivers follow-up messages only after the current run finishes",
    deliversFollowUpMessagesOnlyAfterThe,
  );

  it(
    "runs direct steering and follow-up messages through input handlers",
    runsDirectSteeringAndFollowUpMessages,
  );

  it(
    "delivers multiple steering messages in order in one-at-a-time mode",
    deliversMultipleSteeringMessagesInOrderIn,
  );

  it(
    "delivers multiple follow-up messages in order in one-at-a-time mode",
    deliversMultipleFollowUpMessagesInOrder,
  );

  it(
    "delivers all steering messages in one batch in all mode",
    deliversAllSteeringMessagesInOneBatch,
  );
});

describe("AgentSession queue characterization", () => {
  afterEach(afterEachHook);

  it("delivers all follow-up messages in one batch in all mode", deliversAllFollowUpMessagesInOne);

  it(
    "queues custom messages with deliverAs steer while streaming",
    queuesCustomMessagesWithDeliverasSteerWhile,
  );

  it(
    "queues custom messages with deliverAs followUp while streaming",
    queuesCustomMessagesWithDeliverasFollowupWhile,
  );

  it(
    "injects nextTurn custom messages into the next prompt",
    injectsNextturnCustomMessagesIntoTheNext,
  );

  it(
    "updates pendingMessageCount and removes queued text before message_start is emitted",
    updatesPendingmessagecountAndRemovesQueuedTextBefore,
  );

  it(
    "throws when queueing an extension command with steer",
    throwsWhenQueueingAnExtensionCommandWith,
  );

  it(
    "throws when queueing an extension command with followUp",
    throwsWhenQueueingAnExtensionCommandWith2,
  );

  it("delivers follow-ups queued during agent_end", deliversFollowUpsQueuedDuringAgentEnd);
});
