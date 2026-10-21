import { Clock, Console, Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, inject, it } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import env from "./env.ts";
import jsonCodec from "./json-codec.ts";
import modelChoice from "./model-choice.ts";

const { complete } = compatModule;

type StreamOptionsWithExtras = typesModule.StreamOptions & Record<string, unknown>;

const { hasEnv } = env;
const { encodeJsonPretty } = jsonCodec;
const { chooseModel } = modelChoice;

const openaiCodexToken = inject("storedApiKeys")["openai-codex"];

const calculateTool: typesModule.Tool = {
  description: "Evaluate mathematical expressions",
  name: "calculate",
  parameters: Type.Object({
    expression: Type.String({ description: "The mathematical expression to evaluate" }),
  }),
};

const conversation = (): typesModule.Context => ({
  messages: [],
  systemPrompt:
    "You are a helpful assistant. Use the calculate tool when asked to perform calculations.",
  tools: [calculateTool],
});

const askForToolCall = <TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras,
  context: typesModule.Context,
) =>
  Effect.gen(function* () {
    context.messages.push({
      content: "Please calculate 25 * 18 using the calculate tool.",
      role: "user",
      timestamp: yield* Clock.currentTimeMillis,
    });
    const firstResponse = yield* Effect.promise(() => complete(model, context, options));
    context.messages.push(firstResponse);
    yield* Console.log("First response:", yield* encodeJsonPretty(firstResponse));
    const hasToolCall = firstResponse.content.some((block) => block.type === "toolCall");
    expect(hasToolCall).toBe(true);
    if (!hasToolCall)
      return yield* Effect.die(
        new Error("Expected assistant to make a tool call, but none was found"),
      );
  });

const continueWithoutToolResult = <TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras,
  context: typesModule.Context,
) =>
  Effect.gen(function* () {
    context.messages.push({
      content: "Never mind, just tell me what is 2+2?",
      role: "user",
      timestamp: yield* Clock.currentTimeMillis,
    });
    const secondResponse = yield* Effect.promise(() => complete(model, context, options));
    yield* Console.log("Second response:", yield* encodeJsonPretty(secondResponse));
    expect(secondResponse.stopReason).not.toBe("error");
    expect(secondResponse.content.length).toBeGreaterThan(0);
    const textContent = secondResponse.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join(" ");
    const toolCalls = secondResponse.content.filter((block) => block.type === "toolCall").length;
    expect(toolCalls || textContent.length).toBeGreaterThan(0);
    yield* Console.log("Answer:", textContent);
    expect(["stop", "toolUse"]).toContain(secondResponse.stopReason);
  });

const testToolCallWithoutResult = <TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  options: StreamOptionsWithExtras = {},
) =>
  Effect.suspend(() => {
    const context = conversation();
    return Effect.andThen(
      askForToolCall(model, options, context),
      continueWithoutToolResult(model, options, context),
    );
  });

const runWith =
  <TApi extends typesModule.Api>(
    model: typesModule.Model<TApi>,
    options: StreamOptionsWithExtras = {},
  ) =>
  () =>
    Effect.runPromise(testToolCallWithoutResult(model, options));

const title = "should filter out tool calls without corresponding tool results";
const retried = { retry: 3, timeout: 30000 };

describe("Tool Call Without Result Tests", () => {
  describe.skipIf(!hasEnv("OPENAI_API_KEY"))("OpenAI Completions Provider", () => {
    const { compat: _compat, ...baseModel } = chooseModel(
      "openai",
      "non-reasoning",
      (model) => !model.reasoning,
    );
    it(title, retried, runWith({ ...baseModel, api: "openai-completions" }));
  });

  describe.skipIf(!hasEnv("OPENAI_API_KEY"))("OpenAI Responses Provider", () => {
    it(title, retried, runWith(chooseModel("openai", "reasoning", (model) => model.reasoning)));
  });

  describe.skipIf(!hasEnv("ANTHROPIC_API_KEY"))("Anthropic Provider", () => {
    it(title, retried, runWith(chooseModel("anthropic-api", "chat")));
  });

  describe("OpenAI Codex Provider", () => {
    const model = chooseModel("openai-codex", "chat");
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      `${model.id} - ${title}`,
      retried,
      runWith(model, { apiKey: openaiCodexToken }),
    );
  });
});
