import type agentTypes from "@msa/agent-core/index.types";
import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";
import { Type } from "typebox";
import { expect } from "vite-plus/test";

import agentSessionModelExtensionCases1 from "./agent-session-model-extension-cases-1.ts";
import harnessModule from "./harness.ts";
import type harnessTypes from "./harness.types.ts";

const { fauxAssistantMessage, fauxToolCall } = ai;

const { createHarness, getAssistantTexts } = harnessModule;
const { harnesses } = agentSessionModelExtensionCases1;

const allowsExtensionToolCallHandlersToPart2 = (harness: harnessTypes.Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], {
        stopReason: "toolUse",
      }),
      (context) => {
        const toolResult = context.messages.find((message) => message.role === "toolResult");
        const errorText =
          toolResult?.role === "toolResult"
            ? toolResult.content
                .filter((part): part is { type: "text"; text: string } => part.type === "text")
                .map((part) => part.text)
                .join("\n")
            : "";
        return fauxAssistantMessage(errorText);
      },
    ]);
    yield* Effect.promise(() => harness.session.prompt("hi"));
    expect(getAssistantTexts(harness)).toContain("Blocked by test");
    expect(
      harness.session.messages.find((message) => message.role === "toolResult" && message.isError),
    ).toBeDefined();
  });
const allowsExtensionToolCallHandlersTo = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const echoTool: agentTypes.AgentTool = {
    description: "Echo text back",
    execute: () =>
      runPromise(
        Effect.sync(() => {
          throw new Error("tool should have been blocked");
        }),
      ),
    label: "Echo",
    name: "echo",
    parameters: Type.Object({ text: Type.String() }),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("tool_call", () => Promise.resolve({ block: true, reason: "Blocked by test" }));
        },
      ],
      tools: [echoTool],
    }),
  );
  harnesses.push(harness);
  return yield* allowsExtensionToolCallHandlersToPart2(harness);
});
const toolUsage: aiTypes.Usage = {
  cacheRead: 3,
  cacheWrite: 4,
  cost: { cacheRead: 0.3, cacheWrite: 0.4, input: 0.1, output: 0.2, total: 1 },
  input: 1,
  output: 2,
  totalTokens: 10,
};
const patchedToolUsage: aiTypes.Usage = {
  cacheRead: 7,
  cacheWrite: 8,
  cost: { cacheRead: 0.7, cacheWrite: 0.8, input: 0.5, output: 0.6, total: 2.6 },
  input: 5,
  output: 6,
  totalTokens: 26,
};
const echoToolWithUsage: agentTypes.AgentTool = {
  description: "Echo text back",
  execute: (_toolCallId, params) => {
    const text =
      typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
    return Promise.resolve({
      content: [{ text, type: "text" }],
      details: { text },
      usage: toolUsage,
    });
  },
  label: "Echo",
  name: "echo",
  parameters: Type.Object({ text: Type.String() }),
};
const echoToolResultResponses: aiTypes.FauxResponseStep[] = [
  fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], { stopReason: "toolUse" }),
  (context) => {
    const toolResult = context.messages.find((message) => message.role === "toolResult");
    const text =
      toolResult?.role === "toolResult"
        ? toolResult.content
            .filter((part): part is { type: "text"; text: string } => part.type === "text")
            .map((part) => part.text)
            .join("\n")
        : "";
    return fauxAssistantMessage(text);
  },
];
const allowsExtensionToolResultHandlersTo = Effect.gen(function* () {
  let observedToolUsage: aiTypes.Usage | undefined;
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("tool_result", (event) => {
            observedToolUsage = event.usage;
            return Promise.resolve({
              content: [{ text: "patched result", type: "text" }],
              details: { patched: true },
              usage: patchedToolUsage,
            });
          });
        },
      ],
      tools: [echoToolWithUsage],
    }),
  );
  harnesses.push(harness);
  harness.setResponses(echoToolResultResponses);

  yield* Effect.promise(() => harness.session.prompt("hi"));

  expect(getAssistantTexts(harness)).toContain("patched result");
  const toolResult = harness.session.messages.find(
    (message) =>
      message.role === "toolResult" &&
      typeof message.details === "object" &&
      message.details !== null &&
      !Array.isArray(message.details) &&
      (message.details as aiTypes.JsonObject)["patched"] === true,
  );
  expect(observedToolUsage).toEqual(toolUsage);
  expect(toolResult).toBeDefined();
  expect(toolResult?.role === "toolResult" ? toolResult.usage : undefined).toEqual(
    patchedToolUsage,
  );
});
const allowsExtensionContextHandlersToModify = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("context", (event) =>
            Promise.resolve({
              messages: event.messages.map((message) =>
                message.role === "user"
                  ? {
                      ...message,
                      content: [{ text: "rewritten", type: "text" }],
                      timestamp: message.timestamp,
                    }
                  : message,
              ),
            }),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  let providerUserText = "";
  harness.setResponses([
    (context) => {
      const user = context.messages.find((message) => message.role === "user");
      providerUserText =
        user !== undefined && typeof user.content !== "string"
          ? user.content
              .filter((part): part is { type: "text"; text: string } => part.type === "text")
              .map((part) => part.text)
              .join("\n")
          : "";
      return fauxAssistantMessage("done");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("original"));

  expect(providerUserText).toBe("rewritten");
  const storedUserMessage = harness.session.messages.find((message) => message.role === "user");
  expect(storedUserMessage?.role).toBe("user");
  if (storedUserMessage?.role === "user") {
    expect(storedUserMessage.content).toEqual([{ text: "original", type: "text" }]);
  }
});

const agentSessionModelExtensionCases2 = {
  allowsExtensionContextHandlersToModify,
  allowsExtensionToolCallHandlersTo,
  allowsExtensionToolCallHandlersToPart2,
  allowsExtensionToolResultHandlersTo,
};

export default agentSessionModelExtensionCases2;
