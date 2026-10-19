import { Effect } from "effect";
import { afterEach, describe, it } from "vite-plus/test";

import {
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
} from "./agent-session-queue-cases.ts";

describe("AgentSession queue characterization", () => {
  afterEach(() => {
    while (harnesses.length > 0) {
      harnesses.pop()?.cleanup();
    }
  });
  it("dispatches extension commands immediately when prompted while idle", () =>
    Effect.runPromise(dispatchesExtensionCommandsImmediatelyWhenPrompted));
  it("delivers extension-origin steering messages before the next LLM call", () =>
    Effect.runPromise(deliversExtensionOriginSteeringMessagesBefore));
  it("delivers follow-up messages only after the current run finishes", () =>
    Effect.runPromise(deliversFollowUpMessagesOnlyAfter));
  it("runs direct steering and follow-up messages through input handlers", () =>
    Effect.runPromise(runsDirectSteeringAndFollowUp));
  it("delivers multiple steering messages in order in one-at-a-time mode", () =>
    Effect.runPromise(deliversMultipleSteeringMessagesInOrder));
  it("delivers multiple follow-up messages in order in one-at-a-time mode", () =>
    Effect.runPromise(deliversMultipleFollowUpMessagesIn));
  it("delivers all steering messages in one batch in all mode", () =>
    Effect.runPromise(deliversAllSteeringMessagesInOne));
  it("delivers all follow-up messages in one batch in all mode", () =>
    Effect.runPromise(deliversAllFollowUpMessagesIn));
  it("queues custom messages with deliverAs steer while streaming", () =>
    Effect.runPromise(queuesCustomMessagesWithDeliverasSteer));
  it("queues custom messages with deliverAs followUp while streaming", () =>
    Effect.runPromise(queuesCustomMessagesWithDeliverasFollowup));
  it("injects nextTurn custom messages into the next prompt", () =>
    Effect.runPromise(injectsNextturnCustomMessagesIntoThe));
  it("updates pendingMessageCount and removes queued text before message_start is emitted", () =>
    Effect.runPromise(updatesPendingmessagecountAndRemovesQueuedText));
  it("throws when queueing an extension command with steer", () =>
    Effect.runPromise(throwsWhenQueueingAnExtensionCommand));
  it("throws when queueing an extension command with followUp", () =>
    Effect.runPromise(throwsWhenQueueingAnExtensionCommand2));
  it("delivers follow-ups queued during agent_end", () =>
    Effect.runPromise(deliversFollowUpsQueuedDuringAgent));
});
