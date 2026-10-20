import ai from "@msa/ai";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import agentSessionQueueCases1 from "./agent-session-queue-cases-1.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createWaitingHarness, harnesses } = agentSessionQueueCases1;
const { createHarness, getAssistantTexts, getMessageText } = harnessModule;

const deliversAllFollowUpMessagesIn = Effect.gen(function* () {
  const waiting = yield* Effect.promise(() => createWaitingHarness());
  const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
  harnesses.push(harness);
  harness.session.setFollowUpMode("all");
  let batchedUserMessages: string[] = [];

  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("original turn complete"),
    (context) => {
      batchedUserMessages = context.messages
        .filter((message) => message.role === "user")
        .map((message) => getMessageText(message));
      return fauxAssistantMessage("batched follow-up response");
    },
  ]);

  yield* Effect.promise(() => waitForToolStart);
  yield* Effect.promise(() => harness.session.followUp("follow-up 1"));
  yield* Effect.promise(() => harness.session.followUp("follow-up 2"));
  releaseToolExecution();
  yield* Effect.promise(() => promptPromise);

  expect(batchedUserMessages).toEqual(["start", "follow-up 1", "follow-up 2"]);
  expect(getAssistantTexts(harness)).toEqual([
    "",
    "original turn complete",
    "batched follow-up response",
  ]);
});
const queuesCustomMessagesWithDeliverasSteer = Effect.gen(function* () {
  const waiting = yield* Effect.promise(() => createWaitingHarness());
  const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
  harnesses.push(harness);
  let sawCustomMessage = false;

  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    (context) => {
      sawCustomMessage = context.messages.some(
        (message) =>
          message.role === "user" &&
          typeof message.content !== "string" &&
          message.content.some((part) => part.type === "text" && part.text === "steer custom"),
      );
      return fauxAssistantMessage("done");
    },
  ]);

  yield* Effect.promise(() => waitForToolStart);
  yield* Effect.promise(() =>
    harness.session.sendCustomMessage(
      {
        content: "steer custom",
        customType: "queue-test",
        details: { value: 1 },
        display: true,
      },
      { deliverAs: "steer" },
    ),
  );
  releaseToolExecution();
  yield* Effect.promise(() => promptPromise);

  expect(sawCustomMessage).toBe(true);
  expect(
    harness.session.messages.some(
      (message) => message.role === "custom" && message.customType === "queue-test",
    ),
  ).toBe(true);
});
const queuesCustomMessagesWithDeliverasFollowup = Effect.gen(function* () {
  const waiting = yield* Effect.promise(() => createWaitingHarness());
  const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
  harnesses.push(harness);
  let sawCustomMessage = false;

  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("original turn complete"),
    (context) => {
      sawCustomMessage = context.messages.some(
        (message) =>
          message.role === "user" &&
          typeof message.content !== "string" &&
          message.content.some((part) => part.type === "text" && part.text === "follow-up custom"),
      );
      return fauxAssistantMessage("done");
    },
  ]);

  yield* Effect.promise(() => waitForToolStart);
  yield* Effect.promise(() =>
    harness.session.sendCustomMessage(
      {
        content: "follow-up custom",
        customType: "queue-test",
        details: { value: 1 },
        display: true,
      },
      { deliverAs: "followUp" },
    ),
  );
  releaseToolExecution();
  yield* Effect.promise(() => promptPromise);

  expect(sawCustomMessage).toBe(true);
  expect(
    harness.session.messages.some(
      (message) => message.role === "custom" && message.customType === "queue-test",
    ),
  ).toBe(true);
});
const injectsNextturnCustomMessagesIntoThe = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  let sawCustomMessage = false;

  yield* Effect.promise(() =>
    harness.session.sendCustomMessage(
      { content: "carry this", customType: "next-turn", details: {}, display: true },
      { deliverAs: "nextTurn" },
    ),
  );

  harness.setResponses([
    (context) => {
      sawCustomMessage = context.messages.some(
        (message) =>
          message.role === "user" &&
          typeof message.content !== "string" &&
          message.content.some((part) => part.type === "text" && part.text === "carry this"),
      );
      return fauxAssistantMessage("done");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("normal prompt"));

  expect(sawCustomMessage).toBe(true);
  expect(harness.session.messages.map((message) => message.role)).toEqual([
    "system",
    "user",
    "custom",
    "assistant",
  ]);
});
const updatesPendingmessagecountAndRemovesQueuedText = Effect.gen(function* () {
  const waiting = yield* Effect.promise(() => createWaitingHarness());
  const { harness, waitForToolStart, promptPromise, releaseToolExecution } = waiting;
  harnesses.push(harness);
  const countsAtQueuedMessageStart: number[] = [];

  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);

  harness.session.subscribe((event) => {
    if (
      event.type === "message_start" &&
      event.message.role === "user" &&
      getMessageText(event.message) === "queued"
    ) {
      countsAtQueuedMessageStart.push(harness.session.pendingMessageCount);
    }
  });

  yield* Effect.promise(() => waitForToolStart);
  yield* Effect.promise(() => harness.session.steer("queued"));
  expect(harness.session.pendingMessageCount).toBe(1);
  releaseToolExecution();
  yield* Effect.promise(() => promptPromise);

  expect(countsAtQueuedMessageStart).toEqual([0]);
  expect(harness.session.pendingMessageCount).toBe(0);
});
const throwsWhenQueueingAnExtensionCommand = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.registerCommand("testcmd", {
            description: "Test command",
            handler: () => runPromise(Effect.sync(() => {})),
          });
        },
      ],
    }),
  );
  harnesses.push(harness);

  yield* Effect.promise(() =>
    expect(harness.session.steer("/testcmd queued")).rejects.toThrow(
      'Extension command "/testcmd" cannot be queued. Use prompt() or execute the command when not streaming.',
    ),
  );
});
const throwsWhenQueueingAnExtensionCommand2 = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.registerCommand("testcmd", {
            description: "Test command",
            handler: () => runPromise(Effect.sync(() => {})),
          });
        },
      ],
    }),
  );
  harnesses.push(harness);

  yield* Effect.promise(() =>
    expect(harness.session.followUp("/testcmd queued")).rejects.toThrow(
      'Extension command "/testcmd" cannot be queued. Use prompt() or execute the command when not streaming.',
    ),
  );
});

const agentSessionQueueCases3 = {
  deliversAllFollowUpMessagesIn,
  injectsNextturnCustomMessagesIntoThe,
  queuesCustomMessagesWithDeliverasFollowup,
  queuesCustomMessagesWithDeliverasSteer,
  throwsWhenQueueingAnExtensionCommand,
  throwsWhenQueueingAnExtensionCommand2,
  updatesPendingmessagecountAndRemovesQueuedText,
};

export default agentSessionQueueCases3;
