import { type ChildProcess, execSync, spawn } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

import { Clock, Console, Effect, Random, Stream } from "effect";
import { Type } from "typebox";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { complete, getModel, stream } from "../src/compat.ts";
import type {
  Api,
  Context,
  ImageContent,
  Model,
  StreamOptions,
  Tool,
  ToolResultMessage,
} from "../src/types.ts";
import { envValue } from "./env.ts";
import { decodeJson } from "./json-codec.ts";

type StreamOptionsWithExtras = StreamOptions & Record<string, unknown>;

import { currentTimeMillis } from "../src/utils/clock.ts";
import { StringEnum } from "../src/utils/typebox-helpers.ts";
import { resolveApiKey } from "./oauth.ts";

const openaiCodexToken = await resolveApiKey("openai-codex");

const calculatorSchema = Type.Object({
  a: Type.Number({ description: "First number" }),
  b: Type.Number({ description: "Second number" }),
  operation: StringEnum(["add", "subtract", "multiply", "divide"], {
    description: "The operation to perform. One of 'add', 'subtract', 'multiply', 'divide'.",
  }),
});

const calculatorTool: Tool<typeof calculatorSchema> = {
  name: "math_operation",
  description: "Perform basic arithmetic operations",
  parameters: calculatorSchema,
};

const basicTextGeneration = Effect.fn("basicTextGeneration")(function* <TApi extends Api>(
  model: Model<TApi>,
  options?: StreamOptionsWithExtras,
) {
  const context: Context = {
    systemPrompt: "You are a helpful assistant. Be concise.",
    messages: [
      {
        role: "user",
        content: "Reply with exactly: 'Hello test successful'",
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
  };
  const response = yield* Effect.promise(() => complete(model, context, options));

  expect(response.role).toBe("assistant");
  expect(response.content).toBeTruthy();
  expect(response.usage.input + response.usage.cacheRead).toBeGreaterThan(0);
  expect(response.usage.output).toBeGreaterThan(0);
  expect(response.errorMessage).toBeFalsy();
  expect(response.content.map((b) => (b.type === "text" ? b.text : "")).join("")).toContain(
    "Hello test successful",
  );

  context.messages.push(response, {
    role: "user",
    content: "Now say 'Goodbye test successful'",
    timestamp: yield* Clock.currentTimeMillis,
  });

  const secondResponse = yield* Effect.promise(() => complete(model, context, options));

  expect(secondResponse.role).toBe("assistant");
  expect(secondResponse.content).toBeTruthy();
  expect(secondResponse.usage.input + secondResponse.usage.cacheRead).toBeGreaterThan(0);
  expect(secondResponse.usage.output).toBeGreaterThan(0);
  expect(secondResponse.errorMessage).toBeFalsy();
  expect(secondResponse.content.map((b) => (b.type === "text" ? b.text : "")).join("")).toContain(
    "Goodbye test successful",
  );
});

function handleToolCall<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const context: Context = {
        systemPrompt: "You are a helpful assistant that uses tools when asked.",
        messages: [
          {
            role: "user",
            content: "Calculate 15 + 27 using the math_operation tool.",
            timestamp: yield* Clock.currentTimeMillis,
          },
        ],
        tools: [calculatorTool],
      };

      const s = stream(model, context, options);
      let hasToolStart = false;
      let hasToolDelta = false;
      let hasToolEnd = false;
      let accumulatedToolArgs = "";
      let index = 0;
      yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (event.type === "toolcall_start") {
              hasToolStart = true;
              const toolCall = event.partial.content[event.contentIndex];
              index = event.contentIndex;
              expect(toolCall?.type).toBe("toolCall");
              if (toolCall?.type === "toolCall") {
                expect(toolCall.name).toBe("math_operation");
                expect(toolCall.id).toBeTruthy();
              }
            }
            if (event.type === "toolcall_delta") {
              hasToolDelta = true;
              const toolCall = event.partial.content[event.contentIndex];
              expect(event.contentIndex).toBe(index);
              expect(toolCall?.type).toBe("toolCall");
              if (toolCall?.type === "toolCall") {
                expect(toolCall.name).toBe("math_operation");
                accumulatedToolArgs += event.delta;
                expect(toolCall.arguments).toBeDefined();
                expect(typeof toolCall.arguments).toBe("object");
                expect(toolCall.arguments).not.toBeNull();
              }
            }
            if (event.type === "toolcall_end") {
              hasToolEnd = true;
              const toolCall = event.partial.content[event.contentIndex];
              expect(event.contentIndex).toBe(index);
              expect(toolCall?.type).toBe("toolCall");
              if (toolCall?.type === "toolCall") {
                expect(toolCall.name).toBe("math_operation");
                yield* decodeJson(accumulatedToolArgs);
                expect(toolCall.arguments).not.toBeUndefined();
                expect((toolCall.arguments as any).a).toBe(15);
                expect((toolCall.arguments as any).b).toBe(27);
                expect((toolCall.arguments as any).operation).oneOf([
                  "add",
                  "subtract",
                  "multiply",
                  "divide",
                ]);
              }
            }
          }),
        ),
      );

      expect(hasToolStart).toBe(true);
      expect(hasToolDelta).toBe(true);
      expect(hasToolEnd).toBe(true);

      const response = yield* Effect.promise(() => s.result());
      expect(response.stopReason).toBe("toolUse");
      expect(response.content.some((b) => b.type === "toolCall")).toBeTruthy();
      const toolCall = response.content.find((b) => b.type === "toolCall");
      if (toolCall?.type === "toolCall") {
        expect(toolCall.name).toBe("math_operation");
        expect(toolCall.id).toBeTruthy();
      } else {
        throw new Error("No tool call found in response");
      }
    }),
  );
}

function handleStreaming<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
  return Effect.runPromise(
    Effect.gen(function* () {
      let textStarted = false;
      let textChunks = "";
      let textCompleted = false;

      const context: Context = {
        messages: [
          { role: "user", content: "Count from 1 to 3", timestamp: yield* Clock.currentTimeMillis },
        ],
        systemPrompt: "You are a helpful assistant.",
      };

      const s = stream(model, context, options);

      yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.type === "text_start") {
              textStarted = true;
            } else if (event.type === "text_delta") {
              textChunks += event.delta;
            } else if (event.type === "text_end") {
              textCompleted = true;
            }
          }),
        ),
      );

      const response = yield* Effect.promise(() => s.result());

      expect(textStarted).toBe(true);
      expect(textChunks.length).toBeGreaterThan(0);
      expect(textCompleted).toBe(true);
      expect(response.content.some((b) => b.type === "text")).toBeTruthy();
    }),
  );
}

function handleThinking<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
  return Effect.runPromise(
    Effect.gen(function* () {
      let thinkingStarted = false;
      let thinkingChunks = "";
      let thinkingCompleted = false;

      const context: Context = {
        messages: [
          {
            role: "user",
            content: `Think long and hard about ${yield* Random.nextIntBetween(0, 254)} + 27. Think step by step. Then output the result.`,
            timestamp: yield* Clock.currentTimeMillis,
          },
        ],
        systemPrompt: "You are a helpful assistant.",
      };

      const s = stream(model, context, options);

      yield* Stream.fromAsyncIterable(s, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEach((event) =>
          Effect.sync(() => {
            if (event.type === "thinking_start") {
              thinkingStarted = true;
            } else if (event.type === "thinking_delta") {
              thinkingChunks += event.delta;
            } else if (event.type === "thinking_end") {
              thinkingCompleted = true;
            }
          }),
        ),
      );

      const response = yield* Effect.promise(() => s.result());

      expect(response.stopReason, `Error: ${response.errorMessage}`).toBe("stop");
      expect(thinkingStarted).toBe(true);
      expect(thinkingChunks.length).toBeGreaterThan(0);
      expect(thinkingCompleted).toBe(true);
      expect(response.content.some((b) => b.type === "thinking")).toBeTruthy();
    }),
  );
}

const handleImage = Effect.fn("handleImage")(function* <TApi extends Api>(
  model: Model<TApi>,
  options?: StreamOptionsWithExtras,
) {
  if (!model.input.includes("image")) {
    yield* Console.log(`Skipping image test - model ${model.id} doesn't support images`);
    return;
  }

  const imagePath = join(import.meta.dirname, "data", "red-circle.png");
  const imageBuffer = readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");

  const imageContent: ImageContent = {
    type: "image",
    data: base64Image,
    mimeType: "image/png",
  };

  const context: Context = {
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "What do you see in this image? Please describe the shape (circle, rectangle, square, triangle, ...) and color (red, blue, green, ...). You MUST reply in English.",
          },
          imageContent,
        ],
        timestamp: yield* Clock.currentTimeMillis,
      },
    ],
    systemPrompt: "You are a helpful assistant.",
  };

  const response = yield* Effect.promise(() => complete(model, context, options));

  expect(response.content.length > 0).toBeTruthy();
  const textContent = response.content.find((b) => b.type === "text");
  if (textContent?.type === "text") {
    const lowerContent = textContent.text.toLowerCase();
    expect(lowerContent).toContain("red");
    expect(lowerContent).toContain("circle");
  }
});

async function multiTurn<TApi extends Api>(model: Model<TApi>, options?: StreamOptionsWithExtras) {
  const context: Context = {
    systemPrompt: "You are a helpful assistant that can use tools to answer questions.",
    messages: [
      {
        role: "user",
        content:
          "Think about this briefly, then calculate 42 * 17 and 453 + 434 using the math_operation tool.",
        timestamp: currentTimeMillis(),
      },
    ],
    tools: [calculatorTool],
  };

  let allTextContent = "";
  let hasSeenThinking = false;
  let hasSeenToolCalls = false;
  const maxTurns = 5;

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await complete(model, context, options);

    context.messages.push(response);

    const results: ToolResultMessage[] = [];
    for (const block of response.content) {
      if (block.type === "text") {
        allTextContent += block.text;
      } else if (block.type === "thinking") {
        hasSeenThinking = true;
      } else if (block.type === "toolCall") {
        hasSeenToolCalls = true;

        expect(block.name).toBe("math_operation");
        expect(block.id).toBeTruthy();
        expect(block.arguments).toBeTruthy();

        const { a, b, operation } = block.arguments;
        if (typeof a !== "number" || typeof b !== "number")
          throw new Error("Invalid math arguments");
        let result: number;
        switch (operation) {
          case "add":
            result = a + b;
            break;
          case "multiply":
            result = a * b;
            break;
          default:
            result = 0;
        }

        results.push({
          role: "toolResult",
          toolCallId: block.id,
          toolName: block.name,
          content: [{ type: "text", text: `${result}` }],
          isError: false,
          timestamp: currentTimeMillis(),
        });
      }
    }
    context.messages.push(...results);

    expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
    if (response.stopReason === "stop") {
      break;
    }
  }

  expect(hasSeenThinking || hasSeenToolCalls).toBe(true);

  expect(allTextContent).toBeTruthy();
  expect(allTextContent.includes("714")).toBe(true);
  expect(allTextContent.includes("887")).toBe(true);
}

describe("Generate E2E Tests", () => {
  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Completions Provider (gpt-4o-mini)",
    () => {
      const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini");
      void _compat;
      const llm: Model<"openai-completions"> = {
        ...baseModel,
        api: "openai-completions",
      };

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(llm)));
    },
  );

  describe.skipIf(envValue("OPENAI_API_KEY") === undefined || envValue("OPENAI_API_KEY") === "")(
    "OpenAI Responses Provider (gpt-5.4)",
    () => {
      const llm = getModel("openai", "gpt-5.4");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking", { retry: 2 }, () =>
        handleThinking(llm, { reasoningEffort: "high" }),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, { reasoningEffort: "high" }),
      );

      it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(llm)));
    },
  );

  describe.skipIf(
    envValue("ANTHROPIC_API_KEY") === undefined || envValue("ANTHROPIC_API_KEY") === "",
  )("Anthropic Provider (claude-haiku-4-5)", () => {
    const model = getModel("anthropic-api", "claude-haiku-4-5");

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(model, { thinkingEnabled: true })),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(model));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(model));

    it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(model)));
  });

  describe.skipIf(
    envValue("OPENROUTER_API_KEY") === undefined || envValue("OPENROUTER_API_KEY") === "",
  )("OpenRouter Provider (glm-4.5v via OpenAI Completions)", () => {
    const llm = getModel("openrouter", "z-ai/glm-4.5v");

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

    it("should handle thinking mode", { retry: 3 }, () =>
      handleThinking(llm, { reasoningEffort: "medium" }),
    );

    it("should handle multi-turn with thinking and tools", { retry: 2 }, () =>
      multiTurn(llm, { reasoningEffort: "medium" }),
    );

    it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(llm)));
  });

  describe("OpenAI Codex Provider (gpt-5.5)", () => {
    const llm = getModel("openai-codex", "gpt-5.5");

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should complete basic text generation",
      { retry: 3 },
      () => Effect.runPromise(basicTextGeneration(llm, { apiKey: openaiCodexToken })),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should handle tool calling",
      { retry: 3 },
      () => handleToolCall(llm, { apiKey: openaiCodexToken }),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should handle streaming",
      { retry: 3 },
      () => handleStreaming(llm, { apiKey: openaiCodexToken }),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should handle thinking with reasoningEffort xhigh",
      { retry: 3 },
      () => handleThinking(llm, { apiKey: openaiCodexToken, reasoningEffort: "xhigh" }),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should handle multi-turn with thinking and tools",
      { retry: 3 },
      () => multiTurn(llm, { apiKey: openaiCodexToken, reasoningEffort: "xhigh" }),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should handle image input",
      { retry: 3 },
      () => Effect.runPromise(handleImage(llm, { apiKey: openaiCodexToken })),
    );
  });

  describe("OpenAI Codex Provider (gpt-5.5 via WebSocket)", () => {
    const llm = getModel("openai-codex", "gpt-5.5");
    const wsOptions = { apiKey: openaiCodexToken, transport: "websocket" as const };

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should complete basic text generation",
      { retry: 3 },
      () => Effect.runPromise(basicTextGeneration(llm, wsOptions)),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should handle tool calling",
      { retry: 3 },
      () => handleToolCall(llm, wsOptions),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should handle streaming",
      { retry: 3 },
      () => handleStreaming(llm, wsOptions),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should handle thinking with reasoningEffort xhigh",
      { retry: 3 },
      () => handleThinking(llm, { ...wsOptions, reasoningEffort: "xhigh" }),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should handle multi-turn with thinking and tools",
      { retry: 3 },
      () => multiTurn(llm, { ...wsOptions, reasoningEffort: "xhigh" }),
    );

    it.skipIf(openaiCodexToken === undefined || openaiCodexToken === "")(
      "should handle image input",
      { retry: 3 },
      () => Effect.runPromise(handleImage(llm, wsOptions)),
    );
  });

  let ollamaInstalled = false;
  if (envValue("MSA_NO_LOCAL_LLM") === undefined || envValue("MSA_NO_LOCAL_LLM") === "") {
    try {
      execSync("which ollama", { stdio: "ignore" });
      ollamaInstalled = true;
    } catch {
      ollamaInstalled = false;
    }
  }

  describe.skipIf(!ollamaInstalled)("Ollama Provider (gpt-oss-20b via OpenAI Completions)", () => {
    let llm: Model<"openai-completions">;
    let ollamaProcess: ChildProcess | null = null;

    beforeAll(async () => {
      try {
        execSync("ollama list | grep -q 'gpt-oss:20b'", { stdio: "ignore" });
      } catch {
        console.log("Pulling gpt-oss:20b model for Ollama tests...");
        try {
          execSync("ollama pull gpt-oss:20b", { stdio: "inherit" });
        } catch {
          console.warn("Failed to pull gpt-oss:20b model, tests will be skipped");
          return;
        }
      }

      ollamaProcess = spawn("ollama", ["serve"], {
        detached: false,
        stdio: "ignore",
      });

      await new Promise<void>((resolve) => {
        const checkServer = async () => {
          try {
            const response = await fetch("http://localhost:11434/api/tags");
            if (response.ok) {
              resolve();
            } else {
              setTimeout(checkServer, 500);
            }
          } catch {
            setTimeout(checkServer, 500);
          }
        };
        setTimeout(checkServer, 1000);
      });

      llm = {
        id: "gpt-oss:20b",
        api: "openai-completions",
        provider: "ollama",
        baseUrl: "http://localhost:11434/v1",
        reasoning: true,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16000,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        name: "Ollama GPT-OSS 20B",
      };
    }, 30000);

    afterAll(() => {
      if (ollamaProcess !== null) {
        ollamaProcess.kill("SIGTERM");
        ollamaProcess = null;
      }
    });

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm, { apiKey: "test" })),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm, { apiKey: "test" }));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm, { apiKey: "test" }));

    it("should handle thinking mode", { retry: 3 }, () =>
      handleThinking(llm, { apiKey: "test", reasoningEffort: "medium" }),
    );

    it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
      multiTurn(llm, { apiKey: "test", reasoningEffort: "medium" }),
    );
  });
});
