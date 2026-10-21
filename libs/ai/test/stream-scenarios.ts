import { Clock, Console, Effect, Random, Stream } from "effect";
import { Type } from "typebox";
import { expect } from "vite-plus/test";

import compat from "../src/compat.ts";
import type compatTypes from "../src/compat.types.ts";
import type typesModule from "../src/types.types.ts";
import typeboxHelpers from "../src/utils/typebox-helpers.ts";
import redCircle from "./red-circle.ts";

const { StringEnum } = typeboxHelpers;
const { complete, stream } = compat;

type StreamOptionsWithExtras = typesModule.StreamOptions & Record<string, unknown>;

const calculatorSchema = Type.Object({
  a: Type.Number({ description: "First number" }),
  b: Type.Number({ description: "Second number" }),
  operation: StringEnum(["add", "subtract", "multiply", "divide"], {
    description: "The operation to perform. One of 'add', 'subtract', 'multiply', 'divide'.",
  }),
});

const calculatorTool: typesModule.Tool<typeof calculatorSchema> = {
  description: "Perform basic arithmetic operations",
  name: "math_operation",
  parameters: calculatorSchema,
};

const textOf = (message: typesModule.AssistantMessage) =>
  message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");

const userTurn = (content: string) =>
  Effect.map(Clock.currentTimeMillis, (timestamp) => ({
    content,
    role: "user" as const,
    timestamp,
  }));

const collect = (s: compatTypes.AssistantMessageEventStream) =>
  Effect.gen(function* () {
    const events: typesModule.AssistantMessageEvent[] = [];
    yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
      Stream.orDie,
      Stream.runForEach((event) => Effect.sync(() => events.push(event))),
    );
    return { events, response: yield* Effect.promise(() => s.result()) };
  });

const typesOf = (events: readonly typesModule.AssistantMessageEvent[]) =>
  events.map((event) => event.type);

const expectReply = (response: typesModule.AssistantMessage, expected: string) => {
  expect(response.role).toBe("assistant");
  expect(response.errorMessage).toBeFalsy();
  expect(response.usage.input + response.usage.cacheRead).toBeGreaterThan(0);
  expect(response.usage.output).toBeGreaterThan(0);
  expect(textOf(response)).toContain(expected);
};

const basicTextGeneration = <TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  options?: StreamOptionsWithExtras,
) =>
  Effect.gen(function* () {
    const context: typesModule.Context = {
      messages: [yield* userTurn("Reply with exactly: 'Hello test successful'")],
      systemPrompt: "You are a helpful assistant. Be concise.",
    };
    const first = yield* Effect.promise(() => complete(model, context, options));
    expectReply(first, "Hello test successful");
    context.messages.push(first, yield* userTurn("Now say 'Goodbye test successful'"));
    expectReply(
      yield* Effect.promise(() => complete(model, context, options)),
      "Goodbye test successful",
    );
  });

const handleToolCall = <TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  options?: StreamOptionsWithExtras,
) =>
  Effect.gen(function* () {
    const { events, response } = yield* collect(
      stream(
        model,
        {
          messages: [yield* userTurn("Calculate 15 + 27 using the math_operation tool.")],
          systemPrompt: "You are a helpful assistant that uses tools when asked.",
          tools: [calculatorTool],
        },
        options,
      ),
    );
    expect(typesOf(events)).toEqual(
      expect.arrayContaining(["toolcall_start", "toolcall_delta", "toolcall_end"]),
    );
    const toolEvents = events.filter((event) => event.type.startsWith("toolcall_"));
    expect(
      new Set(toolEvents.map((event) => ("contentIndex" in event ? event.contentIndex : -1))).size,
    ).toBe(1);
    expect(response.stopReason).toBe("toolUse");
    const toolCall = response.content.find((block) => block.type === "toolCall");
    if (toolCall?.type !== "toolCall") throw new Error("No tool call found in response");
    expect(toolCall.name).toBe("math_operation");
    expect(toolCall.id).toBeTruthy();
    expect(toolCall.arguments).toMatchObject({ a: 15, b: 27 });
  });

const expectStreamedBlock = (
  events: readonly typesModule.AssistantMessageEvent[],
  kind: "text" | "thinking",
) => {
  const types = typesOf(events);
  expect(types).toEqual(expect.arrayContaining([`${kind}_start`, `${kind}_delta`, `${kind}_end`]));
  const deltas = events.flatMap((event) =>
    event.type === `${kind}_delta` && "delta" in event ? [event.delta] : [],
  );
  expect(deltas.join("").length).toBeGreaterThan(0);
};

const handleStreaming = <TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  options?: StreamOptionsWithExtras,
) =>
  Effect.gen(function* () {
    const { events, response } = yield* collect(
      stream(
        model,
        {
          messages: [yield* userTurn("Count from 1 to 3")],
          systemPrompt: "You are a helpful assistant.",
        },
        options,
      ),
    );
    expectStreamedBlock(events, "text");
    expect(response.content.some((block) => block.type === "text")).toBe(true);
  });

const handleThinking = <TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  options?: StreamOptionsWithExtras,
) =>
  Effect.gen(function* () {
    const addend = yield* Random.nextIntBetween(0, 254);
    const prompt = `Think long and hard about ${addend} + 27. Think step by step. Then output the result.`;
    const { events, response } = yield* collect(
      stream(
        model,
        { messages: [yield* userTurn(prompt)], systemPrompt: "You are a helpful assistant." },
        options,
      ),
    );
    expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("stop");
    expectStreamedBlock(events, "thinking");
    expect(response.content.some((block) => block.type === "thinking")).toBe(true);
  });

const calculate = (operation: unknown, a: number, b: number) => {
  if (operation === "add") return a + b;
  if (operation === "multiply") return a * b;
  return 0;
};

const answerToolCalls = (
  message: typesModule.AssistantMessage,
  timestamp: number,
): typesModule.ToolResultMessage[] =>
  message.content.flatMap((block) => {
    if (block.type !== "toolCall") return [];
    const { a, b, operation } = block.arguments;
    if (typeof a !== "number" || typeof b !== "number") throw new Error("Invalid math arguments");
    return [
      {
        content: [{ text: `${calculate(operation, a, b)}`, type: "text" }],
        isError: false,
        role: "toolResult",
        timestamp,
        toolCallId: block.id,
        toolName: block.name,
      },
    ];
  });

const multiTurn = <TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  options?: StreamOptionsWithExtras,
) =>
  Effect.gen(function* () {
    const context: typesModule.Context = {
      messages: [
        yield* userTurn(
          "Think about this briefly, then calculate 42 * 17 and 453 + 434 using the math_operation tool.",
        ),
      ],
      systemPrompt: "You are a helpful assistant that can use tools to answer questions.",
      tools: [calculatorTool],
    };
    const replies: typesModule.AssistantMessage[] = [];
    const respond = (turn: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => complete(model, context, options));
        expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
        replies.push(response);
        context.messages.push(
          response,
          ...answerToolCalls(response, yield* Clock.currentTimeMillis),
        );
        if (response.stopReason !== "stop" && turn < 5) yield* respond(turn + 1);
      });
    yield* respond(1);
    const blocks = replies.flatMap((reply) => reply.content);
    expect(blocks.some((block) => block.type === "thinking" || block.type === "toolCall")).toBe(
      true,
    );
    const text = replies.map(textOf).join("");
    expect(text).toContain("714");
    expect(text).toContain("887");
  });

const handleImage = <TApi extends typesModule.Api>(
  model: typesModule.Model<TApi>,
  options?: StreamOptionsWithExtras,
) =>
  Effect.gen(function* () {
    if (!model.input.includes("image")) {
      yield* Console.log(`Skipping image test - model ${model.id} doesn't support images`);
      return;
    }
    const prompt =
      "What do you see in this image? Please describe the shape (circle, rectangle, square, triangle, ...) and color (red, blue, green, ...). You MUST reply in English.";
    const timestamp = yield* Clock.currentTimeMillis;
    const response = yield* Effect.promise(() =>
      complete(
        model,
        {
          messages: [
            {
              content: [
                { text: prompt, type: "text" },
                { data: redCircle.data, mimeType: redCircle.mimeType, type: "image" },
              ],
              role: "user",
              timestamp,
            },
          ],
          systemPrompt: "You are a helpful assistant.",
        },
        options,
      ),
    );
    const text = textOf(response).toLowerCase();
    expect(text).toContain("red");
    expect(text).toContain("circle");
  });

const streamScenarios = {
  basicTextGeneration,
  handleImage,
  handleStreaming,
  handleThinking,
  handleToolCall,
  multiTurn,
};

export default streamScenarios;
