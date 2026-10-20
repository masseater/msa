import {
  type Model,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@msa/ai/compat";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { AgentEvent } from "../src/index.ts";
import fauxModule from "./support/faux.ts";
import type fauxTypes from "./support/faux.types.ts";
import calculate from "./utils/calculate.ts";

const { expectAssistant, fauxAgent, textOf, useFaux } = fauxModule;
const { calculateTool } = calculate;

const createFaux = useFaux();

const basicPrompt = (model: Model<string>) =>
  Effect.gen(function* () {
    const agent = fauxAgent({
      model,
      systemPrompt: "You are a helpful assistant. Keep your responses concise.",
    });
    yield* Effect.promise(() => agent.prompt("What is 2+2? Answer with just the number."));
    expect(agent.state.isStreaming).toBe(false);
    expect(agent.state.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
    ]);
    expect(textOf(expectAssistant(agent.state.messages[2]))).toContain("4");
  });

const toolExecution = (model: Model<string>) =>
  Effect.gen(function* () {
    const agent = fauxAgent({
      model,
      systemPrompt: "You are a helpful assistant. Always use the calculator tool for math.",
      tools: [calculateTool],
    });
    const pending: Array<{ type: AgentEvent["type"]; ids: string[] }> = [];
    agent.subscribe((event) => {
      if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
        pending.push({ ids: [...agent.state.pendingToolCalls], type: event.type });
      }
    });
    yield* Effect.promise(() => agent.prompt("Calculate 123 * 456 using the calculator tool."));
    expect(agent.state.isStreaming).toBe(false);
    expect(agent.state.messages.length).toBeGreaterThanOrEqual(4);
    const toolResult = agent.state.messages.find((message) => message.role === "toolResult");
    if (toolResult?.role !== "toolResult") throw new Error("Expected tool result message");
    expect(textOf(toolResult)).toContain("123 * 456 = 56088");
    expect(textOf(expectAssistant(agent.state.messages.at(-1)))).toContain("56088");
    expect(agent.state.pendingToolCalls.size).toBe(0);
    expect(pending).toEqual([
      { ids: ["calc-1"], type: "tool_execution_start" },
      { ids: [], type: "tool_execution_end" },
    ]);
  });

const abortExecution = (model: Model<string>) =>
  Effect.gen(function* () {
    const agent = fauxAgent({ model });
    const prompt = agent.prompt("Count slowly from 1 to 20.");
    yield* Effect.sleep(30);
    agent.abort();
    yield* Effect.promise(() => prompt);
    expect(agent.state.isStreaming).toBe(false);
    expect(agent.state.messages.length).toBeGreaterThanOrEqual(2);
    const lastMessage = expectAssistant(agent.state.messages.at(-1));
    expect(lastMessage.stopReason).toBe("aborted");
    expect(lastMessage.errorMessage).toBeDefined();
    expect(agent.state.errorMessage).toBe(lastMessage.errorMessage);
  });

const lifecycleTypes = [
  "agent_start",
  "turn_start",
  "message_start",
  "message_update",
  "message_end",
  "turn_end",
  "agent_end",
];

const stateUpdates = (model: Model<string>) =>
  Effect.gen(function* () {
    const agent = fauxAgent({ model });
    const events: AgentEvent["type"][] = [];
    agent.subscribe((event) => {
      events.push(event.type);
    });
    yield* Effect.promise(() => agent.prompt("Count from 1 to 5."));
    for (const type of lifecycleTypes) expect(events).toContain(type);
    expect(events.indexOf("agent_start")).toBeLessThan(events.indexOf("message_start"));
    expect(events.indexOf("message_start")).toBeLessThan(events.indexOf("message_end"));
    expect(events.indexOf("message_end")).toBeLessThan(events.lastIndexOf("agent_end"));
    expect(agent.state.isStreaming).toBe(false);
    expect(agent.state.messages.length).toBe(3);
  });

const multiTurnConversation = (model: Model<string>) =>
  Effect.gen(function* () {
    const agent = fauxAgent({ model });
    yield* Effect.promise(() => agent.prompt("My name is Alice."));
    expect(agent.state.messages.length).toBe(3);
    yield* Effect.promise(() => agent.prompt("What is my name?"));
    expect(agent.state.messages.length).toBe(5);
    expect(textOf(expectAssistant(agent.state.messages[4])).toLowerCase()).toContain("alice");
  });

const mentionsAlice = (content: unknown): boolean =>
  typeof content === "string"
    ? content.includes("Alice")
    : (content as { type: string; text?: string }[]).some(
        (block) => block.type === "text" && block.text?.includes("Alice") === true,
      );

const preservesThinking = Effect.gen(function* () {
  const faux = createFaux({ models: [{ id: "faux-reasoning", reasoning: true }] });
  faux.setResponses([fauxAssistantMessage([fauxThinking("step by step"), fauxText("4")])]);
  const agent = fauxAgent({ model: faux.getModel(), thinkingLevel: "low" });
  yield* Effect.promise(() => agent.prompt("What is 2+2?"));
  expect(expectAssistant(agent.state.messages[2]).content).toEqual([
    { thinking: "step by step", type: "thinking" },
    { text: "4", type: "text" },
  ]);
});

type FauxResponses = Parameters<ReturnType<typeof createFaux>["setResponses"]>[0];

const withFaux =
  (
    responses: FauxResponses,
    run: (model: Model<string>) => Effect.Effect<void>,
    options: fauxTypes.FauxOptions = {},
  ) =>
  () => {
    const faux = createFaux(options);
    faux.setResponses(responses);
    return Effect.runPromise(run(faux.getModel()));
  };

const calculation = [
  fauxAssistantMessage(
    [
      fauxText("Let me calculate that."),
      fauxToolCall("calculate", { expression: "123 * 456" }, { id: "calc-1" }),
    ],
    { stopReason: "toolUse" },
  ),
  fauxAssistantMessage("The result is 56088."),
];

const counting = [
  fauxAssistantMessage(
    "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen",
  ),
];

const rememberAlice: FauxResponses = [
  fauxAssistantMessage("Nice to meet you, Alice."),
  (context) =>
    fauxAssistantMessage(
      context.messages.some((message) => message.role === "user" && mentionsAlice(message.content))
        ? "Your name is Alice."
        : "I do not know your name.",
    ),
];

describe("Agent integration with faux provider", () => {
  it("handles a basic text prompt", withFaux([fauxAssistantMessage("4")], basicPrompt));
  it("executes tools and tracks pending tool calls", withFaux(calculation, toolExecution));
  it(
    "handles abort during streaming",
    withFaux(counting, abortExecution, { tokenSize: { max: 2, min: 2 }, tokensPerSecond: 20 }),
  );
  it(
    "emits lifecycle updates while streaming",
    withFaux([fauxAssistantMessage("1 2 3 4 5")], stateUpdates, { tokenSize: { max: 1, min: 1 } }),
  );
  it("maintains context across multiple turns", withFaux(rememberAlice, multiTurnConversation));
  it("preserves thinking content blocks", () => Effect.runPromise(preservesThinking));
});
