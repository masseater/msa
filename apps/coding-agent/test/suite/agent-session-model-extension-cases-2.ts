import type { AgentTool } from "@msa/agent-core";
import { fauxAssistantMessage, fauxToolCall, type JsonObject, type Usage } from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { expect } from "vite-plus/test";
import { createHarness, getAssistantTexts, type Harness } from "./harness.ts";
import { harnesses } from "./agent-session-model-extension-cases-1.ts";

export const allowsExtensionToolCallHandlersToPart2 = (harness: Harness) =>
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
export const allowsExtensionToolCallHandlersTo = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const echoTool: AgentTool = {
    name: "echo",
    label: "Echo",
    description: "Echo text back",
    parameters: Type.Object({ text: Type.String() }),
    execute: () =>
      runPromise(
        Effect.sync(() => {
          throw new Error("tool should have been blocked");
        }),
      ),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      tools: [echoTool],
      extensionFactories: [
        (msa) => {
          msa.on("tool_call", () => Promise.resolve({ block: true, reason: "Blocked by test" }));
        },
      ],
    }),
  );
  harnesses.push(harness);
  return yield* allowsExtensionToolCallHandlersToPart2(harness);
});
export const allowsExtensionToolResultHandlersTo = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolUsage: Usage = {
    input: 1,
    output: 2,
    cacheRead: 3,
    cacheWrite: 4,
    totalTokens: 10,
    cost: { input: 0.1, output: 0.2, cacheRead: 0.3, cacheWrite: 0.4, total: 1 },
  };
  const patchedToolUsage: Usage = {
    input: 5,
    output: 6,
    cacheRead: 7,
    cacheWrite: 8,
    totalTokens: 26,
    cost: { input: 0.5, output: 0.6, cacheRead: 0.7, cacheWrite: 0.8, total: 2.6 },
  };
  let observedToolUsage: Usage | undefined;
  const echoTool: AgentTool = {
    name: "echo",
    label: "Echo",
    description: "Echo text back",
    parameters: Type.Object({ text: Type.String() }),
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.sync(() => {
          const text =
            typeof params === "object" && params !== null && "text" in params
              ? String(params.text)
              : "";
          return { content: [{ type: "text", text }], details: { text }, usage: toolUsage };
        }),
      ),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      tools: [echoTool],
      extensionFactories: [
        (msa) => {
          msa.on("tool_result", (event) =>
            runPromise(
              Effect.sync(() => {
                observedToolUsage = event.usage;
                return {
                  content: [{ type: "text", text: "patched result" }],
                  details: { patched: true },
                  usage: patchedToolUsage,
                };
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage([fauxToolCall("echo", { text: "hello" })], {
      stopReason: "toolUse",
    }),
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
  ]);

  yield* Effect.promise(() => harness.session.prompt("hi"));

  expect(getAssistantTexts(harness)).toContain("patched result");
  const toolResult = harness.session.messages.find(
    (message) =>
      message.role === "toolResult" &&
      typeof message.details === "object" &&
      message.details !== null &&
      !Array.isArray(message.details) &&
      (message.details as JsonObject)["patched"] === true,
  );
  expect(observedToolUsage).toEqual(toolUsage);
  expect(toolResult).toBeDefined();
  expect(toolResult?.role === "toolResult" ? toolResult.usage : undefined).toEqual(
    patchedToolUsage,
  );
});
export const allowsExtensionContextHandlersToModify = Effect.gen(function* () {
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
                      content: [{ type: "text", text: "rewritten" }],
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
    expect(storedUserMessage.content).toEqual([{ type: "text", text: "original" }]);
  }
});
