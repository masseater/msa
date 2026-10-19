import {
  type AssistantMessage,
  fauxAssistantMessage,
  type Model,
  type ToolResultMessage,
  type UserMessage,
} from "@msa/ai/compat";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { expectAssistant, fauxAgent, textOf, useFaux } from "./support/faux.ts";
import { createUsage, now } from "./support/fixtures.ts";
import { calculateTool } from "./utils/calculate.ts";

const createFaux = useFaux();

const assistantFrom = (
  model: Model<string>,
  content: AssistantMessage["content"],
): AssistantMessage => ({
  role: "assistant",
  content,
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: createUsage(),
  stopReason: "stop",
  timestamp: now(),
});

const userText = (text: string): UserMessage => ({
  role: "user",
  content: [{ type: "text", text }],
  timestamp: now(),
});

const throwsWithoutMessages = Effect.gen(function* () {
  const agent = fauxAgent({ systemPrompt: "Test", model: createFaux().getModel() });
  yield* Effect.promise(() =>
    expect(agent.continue()).rejects.toThrow("No messages to continue from"),
  );
});

const throwsFromAssistantTail = Effect.gen(function* () {
  const model = createFaux().getModel();
  const agent = fauxAgent({ systemPrompt: "Test", model });
  agent.state.messages = [assistantFrom(model, [{ type: "text", text: "Hello" }])];
  yield* Effect.promise(() =>
    expect(agent.continue()).rejects.toThrow("Cannot continue from message role: assistant"),
  );
});

const continuesFromUser = Effect.gen(function* () {
  const faux = createFaux();
  faux.setResponses([fauxAssistantMessage("HELLO WORLD")]);
  const agent = fauxAgent({
    systemPrompt: "You are a helpful assistant. Follow instructions exactly.",
    model: faux.getModel(),
  });
  agent.state.messages = [userText("Say exactly: HELLO WORLD")];
  yield* Effect.promise(() => agent.continue());
  expect(agent.state.isStreaming).toBe(false);
  expect(agent.state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(textOf(expectAssistant(agent.state.messages[1])).toUpperCase()).toContain("HELLO WORLD");
});

const toolResult: ToolResultMessage = {
  role: "toolResult",
  toolCallId: "calc-1",
  toolName: "calculate",
  content: [{ type: "text", text: "5 + 3 = 8" }],
  isError: false,
  timestamp: now(),
};

const continuesFromToolResult = Effect.gen(function* () {
  const faux = createFaux();
  const model = faux.getModel();
  faux.setResponses([fauxAssistantMessage("The answer is 8.")]);
  const agent = fauxAgent({
    systemPrompt:
      "You are a helpful assistant. After getting a calculation result, state the answer clearly.",
    model,
    tools: [calculateTool],
  });
  const toolUse: AssistantMessage = {
    ...assistantFrom(model, [
      { type: "text", text: "Let me calculate that." },
      { type: "toolCall", id: "calc-1", name: "calculate", arguments: { expression: "5 + 3" } },
    ]),
    stopReason: "toolUse",
  };
  agent.state.messages = [userText("What is 5 + 3?"), toolUse, toolResult];
  yield* Effect.promise(() => agent.continue());
  expect(agent.state.isStreaming).toBe(false);
  expect(agent.state.messages.length).toBeGreaterThanOrEqual(4);
  expect(textOf(expectAssistant(agent.state.messages.at(-1)))).toContain("8");
});

describe("Agent.continue() with faux provider", () => {
  it("throws when no messages in context", () => Effect.runPromise(throwsWithoutMessages));
  it("throws when last message is assistant", () => Effect.runPromise(throwsFromAssistantTail));
  it("continues and gets a response when last message is user", () =>
    Effect.runPromise(continuesFromUser));
  it("continues and processes tool results", () => Effect.runPromise(continuesFromToolResult));
});
