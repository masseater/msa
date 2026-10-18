import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import type { ExtensionAPI, InputEvent } from "@msa/coding-agent";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  createHarness,
  getAssistantTexts,
  getMessageText,
  getUserTexts,
  type Harness,
} from "./harness.ts";

function createWaitingHarness(
  options: {
    tools?: AgentTool[];
    extensionFactories?: Harness["session"]["extensionRunner"] extends never
      ? never
      : Array<(msa: ExtensionAPI) => void>;
  } = {},
): Promise<{
  harness: Harness;
  releaseToolExecution: () => void;
  promptPromise: Promise<void>;
  waitForToolStart: Promise<void>;
}> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
      let releaseToolExecution: (() => void) | undefined;
      const toolRelease = new Promise<void>((resolve) => {
        releaseToolExecution = resolve;
      });
      const waitTool: AgentTool = {
        name: "wait",
        label: "Wait",
        description: "Wait for release",
        parameters: Type.Object({}),
        execute: () =>
          runPromise(
            Effect.gen(function* () {
              yield* Effect.promise(() => toolRelease);
              return {
                content: [{ type: "text", text: "released" }],
                details: {},
              };
            }),
          ),
      };
      const harness = yield* Effect.promise(() =>
        createHarness({
          tools: [waitTool, ...(options.tools ?? [])],
          ...(options.extensionFactories === undefined
            ? {}
            : { extensionFactories: options.extensionFactories }),
        }),
      );

      const waitForToolStart = new Promise<void>((resolve) => {
        const unsubscribe = harness.session.subscribe((event) => {
          if (event.type === "tool_execution_start" && event.toolName === "wait") {
            unsubscribe();
            resolve();
          }
        });
      });

      return {
        harness,
        releaseToolExecution: () => releaseToolExecution?.(),
        promptPromise: harness.session.prompt("start"),
        waitForToolStart,
      };
    }),
  );
}

const harnesses: Harness[] = [];

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

  yield* Effect.promise(() => harness.session.prompt("/testcmd hello world"));

  expect(commandRuns).toEqual(["hello world"]);
  expect(harness.getPendingResponseCount()).toBe(0);
  expect(harness.session.messages).toEqual([]);
});

const deliversExtensionOriginSteeringMessagesBefore = Effect.gen(function* () {
  let extensionApi: ExtensionAPI | undefined;
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
  yield* Effect.promise(() => harness.session.followUp("after current run"));
  releaseToolExecution();
  yield* Effect.promise(() => promptPromise);

  expect(getUserTexts(harness)).toEqual(["start", "after current run"]);
  expect(assistantSeenBeforeFollowUp).toContain("");
  expect(getAssistantTexts(harness)).toContain("follow-up response");
});

const runsDirectSteeringAndFollowUp = Effect.gen(function* () {
  const inputEvents: Array<Pick<InputEvent, "text" | "source" | "streamingBehavior">> = [];
  const waiting = yield* Effect.promise(() =>
    createWaitingHarness({
      extensionFactories: [
        (msa) => {
          msa.on("input", (event) => {
            inputEvents.push({
              text: event.text,
              source: event.source,
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
    yield* Effect.promise(() => harness.session.steer("steer me", undefined, { source: "rpc" }));
    yield* Effect.promise(() =>
      harness.session.steer("handle steer", undefined, { source: "rpc" }),
    );
    yield* Effect.promise(() =>
      harness.session.followUp("follow me", undefined, { source: "rpc" }),
    );
    yield* Effect.promise(() =>
      harness.session.followUp("handle follow", undefined, { source: "rpc" }),
    );

    expect(inputEvents).toEqual([
      { text: "steer me", source: "rpc", streamingBehavior: "steer" },
      { text: "handle steer", source: "rpc", streamingBehavior: "steer" },
      { text: "follow me", source: "rpc", streamingBehavior: "followUp" },
      { text: "handle follow", source: "rpc", streamingBehavior: "followUp" },
    ]);
    expect(harness.session.getSteeringMessages()).toEqual(["transformed: steer me"]);
    expect(harness.session.getFollowUpMessages()).toEqual(["transformed: follow me"]);
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
  yield* Effect.promise(() => harness.session.steer("steer 1"));
  yield* Effect.promise(() => harness.session.steer("steer 2"));
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
  yield* Effect.promise(() => harness.session.followUp("follow-up 1"));
  yield* Effect.promise(() => harness.session.followUp("follow-up 2"));
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
  harness.session.setSteeringMode("all");
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
  yield* Effect.promise(() => harness.session.steer("steer 1"));
  yield* Effect.promise(() => harness.session.steer("steer 2"));
  releaseToolExecution();
  yield* Effect.promise(() => promptPromise);

  expect(batchedUserMessages).toEqual(["start", "steer 1", "steer 2"]);
  expect(getAssistantTexts(harness)).toEqual(["", "batched steer response"]);
});

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
        customType: "queue-test",
        content: "steer custom",
        display: true,
        details: { value: 1 },
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
        customType: "queue-test",
        content: "follow-up custom",
        display: true,
        details: { value: 1 },
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
      { customType: "next-turn", content: "carry this", display: true, details: {} },
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

const deliversFollowUpsQueuedDuringAgent = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let sent = false;
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa: ExtensionAPI) => {
          msa.on("agent_end", () =>
            runPromise(
              Effect.sync(() => {
                if (sent) return;
                sent = true;
                msa.sendUserMessage("conflict report", { deliverAs: "followUp" });
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);

  harness.setResponses([fauxAssistantMessage("reply"), fauxAssistantMessage("follow-up reply")]);

  yield* Effect.promise(() => harness.session.prompt("hello"));
  yield* Effect.promise(() => harness.session.agent.waitForIdle());

  expect(getUserTexts(harness)).toEqual(["hello", "conflict report"]);
});

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
