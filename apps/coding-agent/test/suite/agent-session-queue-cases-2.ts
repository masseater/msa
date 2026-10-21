import ai from "@msa/ai";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import agentSessionQueueCases1 from "./agent-session-queue-cases-1.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createHarness, getAssistantTexts, getMessageText, getUserTexts } = harnessModule;
const { createWaitingHarness, harnesses } = agentSessionQueueCases1;

const dispatchesExtensionCommandsImmediatelyWhenPrompted = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const commandRuns: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.registerCommand("testcmd", {
            description: "Test command",
            handler: (args) =>
              runPromise(
                Effect.sync(() => {
                  commandRuns.push(args);
                }),
              ),
          });
        },
      ],
    }),
  );
  harnesses.push(harness);

  yield* Effect.promise(() => harness.session.run.prompting.prompt("/testcmd hello world"));

  expect(commandRuns).toEqual(["hello world"]);
  expect(harness.getPendingResponseCount()).toBe(0);
  expect(harness.session.messages).toEqual([]);
});
const deliversExtensionOriginSteeringMessagesBefore = Effect.gen(function* () {
  let extensionApi: codingAgentTypes.ExtensionAPI | undefined;
  const waiting = yield* Effect.promise(() =>
    createWaitingHarness({
      extensionFactories: [
        (msa) => {
          extensionApi = msa;
        },
      ],
    }),
  );
  const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
  harnesses.push(harness);

  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    (context) => {
      const sawSteer = context.messages.some(
        (message) => message.role === "user" && getMessageText(message) === "steer now",
      );
      return fauxAssistantMessage(sawSteer ? "saw steer" : "missing steer");
    },
  ]);

  yield* Effect.promise(() => waitForToolStart);
  yield* Effect.sleep(0);

  extensionApi?.sendUserMessage("steer now", { deliverAs: "steer" });
  releaseToolExecution();
  yield* Effect.promise(() => promptPromise);

  expect(getUserTexts(harness)).toEqual(["start", "steer now"]);
  expect(getAssistantTexts(harness)).toContain("saw steer");
});
const deliversFollowUpMessagesOnlyAfter = Effect.gen(function* () {
  const waiting = yield* Effect.promise(() => createWaitingHarness());
  const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
  harnesses.push(harness);
  const assistantSeenBeforeFollowUp: string[] = [];

  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    (context) => {
      assistantSeenBeforeFollowUp.push(
        ...context.messages
          .filter((message) => message.role === "assistant")
          .map((message) =>
            message.content
              .filter((part): part is { type: "text"; text: string } => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
          ),
      );
      return fauxAssistantMessage("follow-up response");
    },
  ]);

  yield* Effect.promise(() => waitForToolStart);
  yield* Effect.promise(() => harness.session.run.queue.followUp("after current run"));
  releaseToolExecution();
  yield* Effect.promise(() => promptPromise);

  expect(getUserTexts(harness)).toEqual(["start", "after current run"]);
  expect(assistantSeenBeforeFollowUp).toContain("");
  expect(getAssistantTexts(harness)).toContain("follow-up response");
});
const runsDirectSteeringAndFollowUpSetup = () =>
  Effect.gen(function* () {
    const inputEvents: Array<
      Pick<codingAgentTypes.InputEvent, "text" | "source" | "streamingBehavior">
    > = [];
    const waiting = yield* Effect.promise(() =>
      createWaitingHarness({
        extensionFactories: [
          (msa) => {
            msa.on("input", (event) => {
              inputEvents.push({
                source: event.source,
                text: event.text,
                ...(event.streamingBehavior === undefined
                  ? {}
                  : { streamingBehavior: event.streamingBehavior }),
              });
              if (event.text.startsWith("handle")) return { action: "handled" };
              return { action: "transform", text: `transformed: ${event.text}` };
            });
          },
        ],
      }),
    );
    return { inputEvents, waiting };
  });

const runsDirectSteeringAndFollowUp = Effect.gen(function* () {
  const { inputEvents, waiting } = yield* runsDirectSteeringAndFollowUpSetup();
  const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("steered"),
    fauxAssistantMessage("followed up"),
  ]);

  yield* Effect.promise(() => waitForToolStart);
  inputEvents.length = 0;
  try {
    yield* Effect.promise(() =>
      harness.session.run.queue.steer("steer me", undefined, { source: "rpc" }),
    );
    yield* Effect.promise(() =>
      harness.session.run.queue.steer("handle steer", undefined, { source: "rpc" }),
    );
    yield* Effect.promise(() =>
      harness.session.run.queue.followUp("follow me", undefined, { source: "rpc" }),
    );
    yield* Effect.promise(() =>
      harness.session.run.queue.followUp("handle follow", undefined, { source: "rpc" }),
    );

    expect(inputEvents).toEqual([
      { source: "rpc", streamingBehavior: "steer", text: "steer me" },
      { source: "rpc", streamingBehavior: "steer", text: "handle steer" },
      { source: "rpc", streamingBehavior: "followUp", text: "follow me" },
      { source: "rpc", streamingBehavior: "followUp", text: "handle follow" },
    ]);
    expect(harness.session.run.queue.getSteeringMessages()).toEqual(["transformed: steer me"]);
    expect(harness.session.run.queue.getFollowUpMessages()).toEqual(["transformed: follow me"]);
  } finally {
    releaseToolExecution();
  }
  yield* Effect.promise(() => promptPromise);
});
const deliversMultipleSteeringMessagesInOrder = Effect.gen(function* () {
  const waiting = yield* Effect.promise(() => createWaitingHarness());
  const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
  harnesses.push(harness);

  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("handled steer 1"),
    fauxAssistantMessage("handled steer 2"),
  ]);

  yield* Effect.promise(() => waitForToolStart);
  yield* Effect.promise(() => harness.session.run.queue.steer("steer 1"));
  yield* Effect.promise(() => harness.session.run.queue.steer("steer 2"));
  releaseToolExecution();
  yield* Effect.promise(() => promptPromise);

  expect(getUserTexts(harness)).toEqual(["start", "steer 1", "steer 2"]);
  expect(getAssistantTexts(harness)).toEqual(["", "handled steer 1", "handled steer 2"]);
});
const deliversMultipleFollowUpMessagesIn = Effect.gen(function* () {
  const waiting = yield* Effect.promise(() => createWaitingHarness());
  const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
  harnesses.push(harness);

  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("original turn complete"),
    fauxAssistantMessage("handled follow-up 1"),
    fauxAssistantMessage("handled follow-up 2"),
  ]);

  yield* Effect.promise(() => waitForToolStart);
  yield* Effect.promise(() => harness.session.run.queue.followUp("follow-up 1"));
  yield* Effect.promise(() => harness.session.run.queue.followUp("follow-up 2"));
  releaseToolExecution();
  yield* Effect.promise(() => promptPromise);

  expect(getUserTexts(harness)).toEqual(["start", "follow-up 1", "follow-up 2"]);
  expect(getAssistantTexts(harness)).toEqual([
    "",
    "original turn complete",
    "handled follow-up 1",
    "handled follow-up 2",
  ]);
});
const deliversAllSteeringMessagesInOne = Effect.gen(function* () {
  const waiting = yield* Effect.promise(() => createWaitingHarness());
  const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
  harnesses.push(harness);
  harness.session.run.queue.setSteeringMode("all");
  let batchedUserMessages: string[] = [];

  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    (context) => {
      batchedUserMessages = context.messages
        .filter((message) => message.role === "user")
        .map((message) => getMessageText(message));
      return fauxAssistantMessage("batched steer response");
    },
  ]);

  yield* Effect.promise(() => waitForToolStart);
  yield* Effect.promise(() => harness.session.run.queue.steer("steer 1"));
  yield* Effect.promise(() => harness.session.run.queue.steer("steer 2"));
  releaseToolExecution();
  yield* Effect.promise(() => promptPromise);

  expect(batchedUserMessages).toEqual(["start", "steer 1", "steer 2"]);
  expect(getAssistantTexts(harness)).toEqual(["", "batched steer response"]);
});

const agentSessionQueueCases2 = {
  deliversAllSteeringMessagesInOne,
  deliversExtensionOriginSteeringMessagesBefore,
  deliversFollowUpMessagesOnlyAfter,
  deliversMultipleFollowUpMessagesIn,
  deliversMultipleSteeringMessagesInOrder,
  dispatchesExtensionCommandsImmediatelyWhenPrompted,
  runsDirectSteeringAndFollowUp,
};

export default agentSessionQueueCases2;
