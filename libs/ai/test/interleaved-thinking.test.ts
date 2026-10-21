import { Clock, Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import compat from "../src/compat.ts";
import envApiKeys from "../src/env-api-keys.ts";
import type typesModule from "../src/types.types.ts";
import typeboxHelpers from "../src/utils/typebox-helpers.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { StringEnum } = typeboxHelpers;
const { completeSimple } = compat;
const { getEnvApiKey } = envApiKeys;

const { hasValue } = env;
const { chooseModel, compatValue } = modelChoice;

type Reasoning = "high" | "xhigh";

const calculatorSchema = Type.Object({
  a: Type.Number({ description: "First number" }),
  b: Type.Number({ description: "Second number" }),
  operation: StringEnum(["add", "subtract", "multiply", "divide"], {
    description: "The operation to perform.",
  }),
});

const calculatorTool: typesModule.Tool<typeof calculatorSchema> = {
  description: "Perform basic arithmetic operations",
  name: "calculator",
  parameters: calculatorSchema,
};

type CalculatorOperation = "add" | "subtract" | "multiply" | "divide";

type CalculatorArguments = {
  a: number;
  b: number;
  operation: CalculatorOperation;
};

function asCalculatorArguments(args: typesModule.ToolCall["arguments"]): CalculatorArguments {
  if (typeof args !== "object" || args === null) {
    throw new Error("Tool arguments must be an object");
  }

  const value = args as Record<string, unknown>;
  const operation = value["operation"];
  if (
    typeof value["a"] !== "number" ||
    typeof value["b"] !== "number" ||
    (operation !== "add" &&
      operation !== "subtract" &&
      operation !== "multiply" &&
      operation !== "divide")
  ) {
    throw new Error("Invalid calculator arguments");
  }

  return { a: value["a"], b: value["b"], operation };
}

function evaluateCalculatorCall(toolCall: typesModule.ToolCall): number {
  const { a, b, operation } = asCalculatorArguments(toolCall.arguments);
  switch (operation) {
    case "add":
      return a + b;
    case "subtract":
      return a - b;
    case "multiply":
      return a * b;
    case "divide":
      return a / b;
  }
}

const calculatorContext = (timestamp: number): typesModule.Context => ({
  messages: [
    {
      content: [
        "Use calculator to calculate 328 * 29.",
        "You must call the calculator tool exactly once.",
        "Provide the final answer based on the best guess given the tool result, even if it seems unreliable.",
        "Start by thinking about the steps you will take to solve the problem.",
      ].join(" "),
      role: "user",
      timestamp,
    },
  ],
  systemPrompt: [
    "You are a helpful assistant that must use tools for arithmetic.",
    "Always think before every tool call, not just the first one.",
    "Do not answer with plain text when a tool call is required.",
  ].join(" "),
  tools: [calculatorTool],
});

const thinksBeforeTheToolCall = <TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  reasoning: Reasoning,
  context: typesModule.Context,
) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() => completeSimple(llm, context, { reasoning }));
    expect(response.stopReason, `Error: ${response.errorMessage}`).toBe(
      "toolUse" satisfies typesModule.StopReason,
    );
    expect(response.content.some((block) => block.type === "thinking")).toBe(true);
    const toolCall = response.content.find((block) => block.type === "toolCall");
    expect(toolCall?.type).toBe("toolCall");
    if (toolCall === undefined || toolCall.type !== "toolCall")
      return yield* Effect.die(new Error("Expected first response to include a tool call"));
    context.messages.push(response);
    return toolCall;
  });

const thinksAgainAfterTheToolResult = <TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  reasoning: Reasoning,
  context: typesModule.Context,
  toolCall: typesModule.ToolCall,
) =>
  Effect.gen(function* () {
    const correctAnswer = evaluateCalculatorCall(toolCall);
    context.messages.push({
      content: [{ text: `The answer is ${correctAnswer} or ${correctAnswer * 2}.`, type: "text" }],
      isError: false,
      role: "toolResult",
      timestamp: yield* Clock.currentTimeMillis,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
    });
    const response = yield* Effect.promise(() => completeSimple(llm, context, { reasoning }));
    expect(response.stopReason, `Error: ${response.errorMessage}`).toBe(
      "stop" satisfies typesModule.StopReason,
    );
    expect(response.content.some((block) => block.type === "thinking")).toBe(true);
    expect(response.content.some((block) => block.type === "text")).toBe(true);
  });

const assertSecondToolCallWithInterleavedThinking = <TApi extends typesModule.Api>(
  llm: typesModule.Model<TApi>,
  reasoning: Reasoning,
) =>
  Effect.gen(function* () {
    const context = calculatorContext(yield* Clock.currentTimeMillis);
    const toolCall = yield* thinksBeforeTheToolCall(llm, reasoning, context);
    yield* thinksAgainAfterTheToolResult(llm, reasoning, context, toolCall);
  });

const hasAnthropicCredentials = hasValue(getEnvApiKey("anthropic-api"));

const budgetThinkingModel = chooseModel(
  "anthropic-api",
  "budget thinking",
  (model) => model.reasoning && compatValue(model, "forceAdaptiveThinking") !== true,
);

const adaptiveThinkingModel = chooseModel(
  "anthropic-api",
  "adaptive thinking",
  (model) => compatValue(model, "forceAdaptiveThinking") === true,
);

describe.skipIf(!hasAnthropicCredentials)("Anthropic interleaved thinking", () => {
  it(
    `should do interleaved thinking with budget thinking on ${budgetThinkingModel.id}`,
    { retry: 3 },
    () =>
      Effect.runPromise(assertSecondToolCallWithInterleavedThinking(budgetThinkingModel, "high")),
  );

  it(
    `should do interleaved thinking with adaptive thinking on ${adaptiveThinkingModel.id}`,
    { retry: 3 },
    () =>
      Effect.runPromise(assertSecondToolCallWithInterleavedThinking(adaptiveThinkingModel, "high")),
  );
});
