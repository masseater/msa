import { Clock, Console, Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { complete, getModel } from "../src/compat.ts";
import type { Api, Context, Model, StreamOptions, Tool } from "../src/types.ts";
import { envValue } from "./env.ts";
import { encodeJsonPretty } from "./json-codec.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { resolveApiKey } from "./oauth.ts";

const openaiCodexToken = await resolveApiKey("openai-codex");

const calculateSchema = Type.Object({
  expression: Type.String({ description: "The mathematical expression to evaluate" }),
});

const calculateTool: Tool = {
  name: "calculate",
  description: "Evaluate mathematical expressions",
  parameters: calculateSchema,
};

const testToolCallWithoutResult = Effect.fn("testToolCallWithoutResult")(function* <
  TApi extends Api,
>(model: Model<TApi>, options: StreamOptionsWithExtras = {}) {
  const context: Context = {
    systemPrompt:
      "You are a helpful assistant. Use the calculate tool when asked to perform calculations.",
    messages: [],
    tools: [calculateTool],
  };

  context.messages.push({
    role: "user",
    content: "Please calculate 25 * 18 using the calculate tool.",
    timestamp: yield* Clock.currentTimeMillis,
  });

  const firstResponse = yield* Effect.promise(() => complete(model, context, options));
  context.messages.push(firstResponse);

  yield* Console.log("First response:", yield* encodeJsonPretty(firstResponse));

  const hasToolCall = firstResponse.content.some((block) => block.type === "toolCall");
  expect(hasToolCall).toBe(true);

  if (!hasToolCall) {
    throw new Error("Expected assistant to make a tool call, but none was found");
  }

  context.messages.push({
    role: "user",
    content: "Never mind, just tell me what is 2+2?",
    timestamp: yield* Clock.currentTimeMillis,
  });

  const secondResponse = yield* Effect.promise(() => complete(model, context, options));
  yield* Console.log("Second response:", yield* encodeJsonPretty(secondResponse));

  expect(secondResponse.stopReason).not.toBe("error");

  expect(secondResponse.content.length).toBeGreaterThan(0);

  const textContent = secondResponse.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join(" ");
  const toolCalls = secondResponse.content.filter((block) => block.type === "toolCall").length;
  expect(toolCalls || textContent.length).toBeGreaterThan(0);
  yield* Console.log("Answer:", textContent);

  expect(["stop", "toolUse"]).toContain(secondResponse.stopReason);
});

describe("Tool Call Without Result Tests", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider",
    () => {
      const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
      void _compat;
      const model: Model<"openai-completions"> = {
        ...baseModel,
        api: "openai-completions",
      };

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider",
    () => {
      const model = getModel("openai", "gpt-5-mini");

      it(
        "should filter out tool calls without corresponding tool results",
        { retry: 3, timeout: 30000 },
        () => Effect.runPromise(testToolCallWithoutResult(model)),
      );
    },
  );
});

describe("Tool Call Without Result Tests", () => {
  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider", () => {
    const model = getModel("anthropic-api", "claude-haiku-4-5");

    it(
      "should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () => Effect.runPromise(testToolCallWithoutResult(model)),
    );
  });
});

describe("Tool Call Without Result Tests", () => {
  describe("OpenAI Codex Provider", () => {
    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "gpt-5.5 - should filter out tool calls without corresponding tool results",
      { retry: 3, timeout: 30000 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const model = getModel("openai-codex", "gpt-5.5");
            yield* testToolCallWithoutResult(model, { apiKey: openaiCodexToken });
          }),
        ),
    );
  });
});
