import {
  type AssistantMessage,
  type Model,
  type ToolResultMessage,
  type UserMessage,
  fauxAssistantMessage,
} from "@msa/ai/compat";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import fauxModule from "./support/faux.ts";
import fixtures from "./support/fixtures.ts";
import calculate from "./utils/calculate.ts";

const { expectAssistant, fauxAgent, textOf, useFaux } = fauxModule;
const { createUsage, now } = fixtures;
const { calculateTool } = calculate;

const createFaux = useFaux();

const assistantFrom = (
  model: Model<string>,
  content: AssistantMessage["content"],
): AssistantMessage => ({
  api: model.api,
  content,
  model: model.id,
  provider: model.provider,
  role: "assistant",
  stopReason: "stop",
  timestamp: now(),
  usage: createUsage(),
});

const userText = (text: string): UserMessage => ({
  content: [{ text, type: "text" }],
  role: "user",
  timestamp: now(),
});

const throwsWithoutMessages = Effect.gen(function* () {
  const agent = fauxAgent({ model: createFaux().getModel(), systemPrompt: "Test" });
  yield* Effect.promise(() =>
    expect(agent.continue()).rejects.toThrow("No messages to continue from"),
  );
});

const throwsFromAssistantTail = Effect.gen(function* () {
  const model = createFaux().getModel();
  const agent = fauxAgent({ model, systemPrompt: "Test" });
  agent.state.messages = [assistantFrom(model, [{ text: "Hello", type: "text" }])];
  yield* Effect.promise(() =>
    expect(agent.continue()).rejects.toThrow("Cannot continue from message role: assistant"),
  );
});

const continuesFromUser = Effect.gen(function* () {
  const faux = createFaux();
  faux.setResponses([fauxAssistantMessage("HELLO WORLD")]);
  const agent = fauxAgent({
    model: faux.getModel(),
    systemPrompt: "You are a helpful assistant. Follow instructions exactly.",
  });
  agent.state.messages = [userText("Say exactly: HELLO WORLD")];
  yield* Effect.promise(() => agent.continue());
  expect(agent.state.isStreaming).toBe(false);
  expect(agent.state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(textOf(expectAssistant(agent.state.messages[1])).toUpperCase()).toContain("HELLO WORLD");
});

const toolResult: ToolResultMessage = {
  content: [{ text: "5 + 3 = 8", type: "text" }],
  isError: false,
  role: "toolResult",
  timestamp: now(),
  toolCallId: "calc-1",
  toolName: "calculate",
};

const continuesFromToolResult = Effect.gen(function* () {
  const faux = createFaux();
  const model = faux.getModel();
  faux.setResponses([fauxAssistantMessage("The answer is 8.")]);
  const agent = fauxAgent({
    model,
    systemPrompt:
      "You are a helpful assistant. After getting a calculation result, state the answer clearly.",
    tools: [calculateTool],
  });
  const toolUse: AssistantMessage = {
    ...assistantFrom(model, [
      { text: "Let me calculate that.", type: "text" },
      { arguments: { expression: "5 + 3" }, id: "calc-1", name: "calculate", type: "toolCall" },
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
