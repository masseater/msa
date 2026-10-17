import { type ChildProcess, execSync, spawn } from "child_process";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

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
import { hasAzureOpenAICredentials, resolveAzureDeploymentName } from "./azure-utils.ts";
import { hasBedrockCredentials } from "./bedrock-utils.ts";
import {
  hasCloudflareAiGatewayCredentials,
  hasCloudflareWorkersAICredentials,
} from "./cloudflare-utils.ts";
import { resolveApiKey } from "./oauth.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const oauthTokens = await Promise.all([resolveApiKey("anthropic"), resolveApiKey("openai-codex")]);
const [anthropicOAuthToken, openaiCodexToken] = oauthTokens;

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

  context.messages.push(response);
  context.messages.push({
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
      if (toolCall !== undefined && toolCall.type === "toolCall") {
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

  const imagePath = join(__dirname, "data", "red-circle.png");
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
  if (textContent !== undefined && textContent.type === "text") {
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
  describe.skipIf(envValue("GEMINI_API_KEY") === undefined || envValue("GEMINI_API_KEY") === "")(
    "Gemini Provider (gemini-2.5-flash)",
    () => {
      const llm = getModel("google", "gemini-2.5-flash");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking", { retry: 3 }, () =>
        handleThinking(llm, { thinking: { enabled: true, budgetTokens: 1024 } }),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, { thinking: { enabled: true, budgetTokens: 2048 } }),
      );

      it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(llm)));
    },
  );

  describe("Google Vertex Provider (gemini-3-flash-preview)", () => {
    const vertexProject = envValue("GOOGLE_CLOUD_PROJECT") || envValue("GCLOUD_PROJECT");
    const vertexLocation = envValue("GOOGLE_CLOUD_LOCATION");
    const vertexApiKey = envValue("GOOGLE_CLOUD_API_KEY");
    const isVertexConfigured = Boolean(vertexProject && vertexLocation);
    const vertexOptions = { project: vertexProject, location: vertexLocation } as const;
    const llm = getModel("google-vertex", "gemini-3-flash-preview");

    it.skipIf(!isVertexConfigured)("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm, vertexOptions)),
    );

    it.skipIf(vertexApiKey === undefined || vertexApiKey === "")(
      "should complete basic text generation with Vertex API key",
      { retry: 3 },
      () => Effect.runPromise(basicTextGeneration(llm, { apiKey: vertexApiKey! })),
    );

    it.skipIf(!isVertexConfigured)("should handle tool calling", { retry: 3 }, () =>
      handleToolCall(llm, vertexOptions),
    );

    it.skipIf(!isVertexConfigured)("should handle thinking", { retry: 3 }, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const { ThinkingLevel } = yield* Effect.promise(() => import("@google/genai"));
          yield* Effect.promise(() =>
            handleThinking(llm, {
              ...vertexOptions,
              thinking: { enabled: true, budgetTokens: 1024, level: ThinkingLevel.LOW },
            }),
          );
        }),
      ),
    );

    it.skipIf(!isVertexConfigured)("should handle streaming", { retry: 3 }, () =>
      handleStreaming(llm, vertexOptions),
    );

    it.skipIf(!isVertexConfigured)(
      "should handle multi-turn with thinking and tools",
      { retry: 3 },
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const { ThinkingLevel } = yield* Effect.promise(() => import("@google/genai"));
            yield* Effect.promise(() =>
              multiTurn(llm, {
                ...vertexOptions,
                thinking: { enabled: true, budgetTokens: 1024, level: ThinkingLevel.MEDIUM },
              }),
            );
          }),
        ),
    );

    it.skipIf(!isVertexConfigured)("should handle image input", { retry: 3 }, () =>
      Effect.runPromise(handleImage(llm, vertexOptions)),
    );
  });

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

  describe.skipIf(
    envValue("DEEPSEEK_API_KEY") === undefined || envValue("DEEPSEEK_API_KEY") === "",
  )("DeepSeek Provider (deepseek-flash via OpenAI Completions)", () => {
    const llm = getModel("deepseek", "deepseek-flash");

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

    it("should handle thinking mode", { retry: 3 }, () =>
      handleThinking(llm, { reasoningEffort: "high" }),
    );

    it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
      multiTurn(llm, { reasoningEffort: "high" }),
    );
  });

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
    const model = getModel("anthropic", "claude-haiku-4-5");

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(model, { thinkingEnabled: true })),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(model));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(model));

    it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(model)));
  });

  describe.skipIf(!hasAzureOpenAICredentials())(
    "Azure OpenAI Responses Provider (gpt-4o-mini)",
    () => {
      const llm = getModel("azure", "gpt-4o-mini");
      const azureDeploymentName = resolveAzureDeploymentName(llm.id);
      const azureOptions =
        azureDeploymentName !== undefined && azureDeploymentName !== ""
          ? { azureDeploymentName }
          : {};

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm, azureOptions)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm, azureOptions));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm, azureOptions));

      it("should handle image input", { retry: 3 }, () =>
        Effect.runPromise(handleImage(llm, azureOptions)),
      );
    },
  );

  describe.skipIf(envValue("XAI_API_KEY") === undefined || envValue("XAI_API_KEY") === "")(
    "xAI Provider (grok-4.7 via OpenAI Responses)",
    () => {
      const llm = getModel("xai", "grok-4.7");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () =>
        handleThinking(llm, { reasoningEffort: "medium" }),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, { reasoningEffort: "medium" }),
      );
    },
  );

  describe.skipIf(envValue("GROQ_API_KEY") === undefined || envValue("GROQ_API_KEY") === "")(
    "Groq Provider (gpt-oss-20b via OpenAI Completions)",
    () => {
      const llm = getModel("groq", "openai/gpt-oss-20b");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () =>
        handleThinking(llm, { reasoningEffort: "medium" }),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, { reasoningEffort: "medium" }),
      );
    },
  );

  describe.skipIf(
    envValue("CEREBRAS_API_KEY") === undefined || envValue("CEREBRAS_API_KEY") === "",
  )("Cerebras Provider (gpt-oss-120b via OpenAI Completions)", () => {
    const llm = getModel("cerebras", "gpt-oss-120b");

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

    it("should handle thinking mode", { retry: 3 }, () =>
      handleThinking(llm, { reasoningEffort: "medium" }),
    );

    it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
      multiTurn(llm, { reasoningEffort: "medium" }),
    );
  });

  describe.skipIf(!hasCloudflareWorkersAICredentials())(
    "Cloudflare Workers AI Provider (Kimi K2.6 via OpenAI Completions)",
    () => {
      const llm = getModel("cloudflare-workers-ai", "@cf/moonshotai/kimi-k2.6");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () =>
        handleThinking(llm, { reasoningEffort: "medium" }),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, { reasoningEffort: "medium" }),
      );
    },
  );

  describe.skipIf(!hasCloudflareAiGatewayCredentials())(
    "Cloudflare AI Gateway → Workers AI (Kimi K2.6 via /compat)",
    () => {
      const llm = getModel("cloudflare-ai-gateway", "workers-ai/@cf/moonshotai/kimi-k2.6");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () =>
        handleThinking(llm, { reasoningEffort: "medium" }),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, { reasoningEffort: "medium" }),
      );
    },
  );

  describe.skipIf(
    !hasCloudflareAiGatewayCredentials() ||
      envValue("OPENAI_API_KEY") === undefined ||
      envValue("OPENAI_API_KEY") === "",
  )("Cloudflare AI Gateway → OpenAI BYOK (gpt-5.1 via /openai responses)", () => {
    const llm = getModel("cloudflare-ai-gateway", "gpt-5.1");
    const options = { headers: { Authorization: `Bearer ${envValue("OPENAI_API_KEY")}` } };
    const thinkingOptions = {
      ...options,
      thinkingEnabled: true,
      reasoningEffort: "medium",
    } satisfies StreamOptionsWithExtras;

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm, options)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm, options));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm, options));

    it("should handle thinking mode", { retry: 3 }, () => handleThinking(llm, thinkingOptions));

    it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
      multiTurn(llm, thinkingOptions),
    );
  });

  describe.skipIf(
    !hasCloudflareAiGatewayCredentials() ||
      envValue("ANTHROPIC_API_KEY") === undefined ||
      envValue("ANTHROPIC_API_KEY") === "",
  )("Cloudflare AI Gateway → Anthropic BYOK (claude-sonnet-4-5 via /anthropic messages)", () => {
    const llm = getModel("cloudflare-ai-gateway", "claude-sonnet-4-5");
    const options = { headers: { Authorization: `Bearer ${envValue("ANTHROPIC_API_KEY")}` } };
    const thinkingOptions = {
      ...options,
      thinkingEnabled: true,
      reasoningEffort: "high",
    } satisfies StreamOptionsWithExtras;

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm, options)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm, options));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm, options));

    it("should handle thinking mode", { retry: 3 }, () => handleThinking(llm, thinkingOptions));

    it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
      multiTurn(llm, thinkingOptions),
    );
  });

  describe.skipIf(envValue("HF_TOKEN") === undefined || envValue("HF_TOKEN") === "")(
    "Hugging Face Provider (Kimi-K2.5 via OpenAI Completions)",
    () => {
      const llm = getModel("huggingface", "moonshotai/Kimi-K2.5");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () =>
        handleThinking(llm, { reasoningEffort: "medium" }),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, { reasoningEffort: "medium" }),
      );
    },
  );

  describe.skipIf(
    envValue("TOGETHER_API_KEY") === undefined || envValue("TOGETHER_API_KEY") === "",
  )("Together AI Provider (Kimi-K3 via OpenAI Completions)", () => {
    const llm = getModel("together", "moonshotai/Kimi-K3");

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

    it("should handle thinking mode", { retry: 3 }, () =>
      handleThinking(llm, { reasoningEffort: "high" }),
    );

    it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
      multiTurn(llm, { reasoningEffort: "high" }),
    );

    it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(llm)));
  });

  describe.skipIf(envValue("BASETEN_API_KEY") === undefined || envValue("BASETEN_API_KEY") === "")(
    "Baseten Provider (GLM 5.2 via OpenAI Completions)",
    () => {
      const llm = getModel("baseten", "zai-org/GLM-5.2");
      const options = { reasoningEffort: "high" } satisfies StreamOptionsWithExtras;

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm, options)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm, options));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm, options));

      it("should handle thinking mode", { retry: 3 }, () => handleThinking(llm, options));

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, options),
      );
    },
  );

  describe.skipIf(envValue("NVIDIA_API_KEY") === undefined || envValue("NVIDIA_API_KEY") === "")(
    "NVIDIA NIM Provider (Nemotron 3 Ultra via OpenAI Completions)",
    () => {
      const llm = getModel("nvidia", "nvidia/nemotron-3-ultra-550b-a55b");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () =>
        handleThinking(llm, { reasoningEffort: "high" }),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, { reasoningEffort: "high" }),
      );
    },
  );

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

  describe.skipIf(
    envValue("AI_GATEWAY_API_KEY") === undefined || envValue("AI_GATEWAY_API_KEY") === "",
  )("Vercel AI Gateway Provider (google/gemini-2.5-flash via Anthropic Messages)", () => {
    const llm = getModel("vercel-ai-gateway", "google/gemini-2.5-flash");

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

    it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(llm)));

    it("should handle multi-turn with tools", { retry: 3 }, () => multiTurn(llm));
  });

  describe.skipIf(
    envValue("AI_GATEWAY_API_KEY") === undefined || envValue("AI_GATEWAY_API_KEY") === "",
  )("Vercel AI Gateway Provider (anthropic/claude-opus-4.5 via Anthropic Messages)", () => {
    const llm = getModel("vercel-ai-gateway", "anthropic/claude-opus-4.5");

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

    it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(llm)));

    it("should handle multi-turn with tools", { retry: 3 }, () => multiTurn(llm));
  });

  describe.skipIf(
    envValue("AI_GATEWAY_API_KEY") === undefined || envValue("AI_GATEWAY_API_KEY") === "",
  )("Vercel AI Gateway Provider (openai/gpt-5.1-codex-max via Anthropic Messages)", () => {
    const llm = getModel("vercel-ai-gateway", "openai/gpt-5.1-codex-max");

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

    it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(llm)));

    it("should handle multi-turn with tools", { retry: 3 }, () => multiTurn(llm));
  });

  describe.skipIf(envValue("ZAI_API_KEY") === undefined || envValue("ZAI_API_KEY") === "")(
    "zAI Provider (glm-5.2 via OpenAI Completions)",
    () => {
      const llm = getModel("zai", "glm-5.2");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () =>
        handleThinking(llm, { reasoningEffort: "medium" }),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, { reasoningEffort: "medium" }),
      );

      it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(llm)));
    },
  );

  describe.skipIf(envValue("MISTRAL_API_KEY") === undefined || envValue("MISTRAL_API_KEY") === "")(
    "Mistral Provider (devstral-medium-latest)",
    () => {
      const llm = getModel("mistral", "devstral-medium-latest");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("mistral", "mistral-small-2603");
            yield* Effect.promise(() => handleThinking(llm, { reasoningEffort: "high" }));
          }),
        ),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llm = getModel("mistral", "mistral-small-2603");
            yield* Effect.promise(() => multiTurn(llm, { reasoningEffort: "high" }));
          }),
        ),
      );
    },
  );

  describe.skipIf(envValue("MISTRAL_API_KEY") === undefined || envValue("MISTRAL_API_KEY") === "")(
    "Mistral Provider (pixtral-12b with image support)",
    () => {
      const llm = getModel("mistral", "pixtral-12b");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(llm)));
    },
  );

  describe.skipIf(envValue("MINIMAX_API_KEY") === undefined || envValue("MINIMAX_API_KEY") === "")(
    "MiniMax Provider (MiniMax-M2.7 via Anthropic Messages)",
    () => {
      const llm = getModel("minimax", "MiniMax-M2.7");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () =>
        handleThinking(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 }),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 }),
      );
    },
  );

  describe.skipIf(envValue("KIMI_API_KEY") === undefined || envValue("KIMI_API_KEY") === "")(
    "Kimi For Coding Provider (kimi-for-coding via OpenAI Completions)",
    () => {
      const llm = getModel("kimi-coding", "kimi-for-coding");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () =>
        handleThinking(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 }),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 }),
      );
    },
  );

  describe.skipIf(envValue("META_API_KEY") === undefined || envValue("META_API_KEY") === "")(
    "Meta Provider (muse-spark-1.3 via OpenAI Responses)",
    () => {
      const llm = getModel("meta", "muse-spark-1.3");

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () =>
        handleThinking(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 }),
      );

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 }),
      );
    },
  );

  describe.skipIf(envValue("XIAOMI_API_KEY") === undefined || envValue("XIAOMI_API_KEY") === "")(
    "Xiaomi MiMo (API billing) Provider (Xiaomi MiMo-V2.6-Pro via Anthropic Messages)",
    () => {
      const llm = getModel("xiaomi", "mimo-v2.6-pro");
      const thinkingOptions = {
        thinkingEnabled: true,
        reasoningEffort: "high",
      } satisfies StreamOptionsWithExtras;

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () => handleThinking(llm, thinkingOptions));

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, thinkingOptions),
      );
    },
  );

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_CN_API_KEY") === "",
  )(
    "Xiaomi MiMo Token Plan Provider (Xiaomi MiMo-V2.6-Pro via Anthropic Messages, CN region)",
    () => {
      const llm = getModel("xiaomi-token-plan-cn", "mimo-v2.6-pro");
      const thinkingOptions = {
        thinkingEnabled: true,
        reasoningEffort: "high",
      } satisfies StreamOptionsWithExtras;

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () => handleThinking(llm, thinkingOptions));

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, thinkingOptions),
      );
    },
  );

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_AMS_API_KEY") === "",
  )(
    "Xiaomi MiMo Token Plan Provider (Xiaomi MiMo-V2.6-Pro via Anthropic Messages, AMS region)",
    () => {
      const llm = getModel("xiaomi-token-plan-ams", "mimo-v2.6-pro");
      const thinkingOptions = {
        thinkingEnabled: true,
        reasoningEffort: "high",
      } satisfies StreamOptionsWithExtras;

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () => handleThinking(llm, thinkingOptions));

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, thinkingOptions),
      );
    },
  );

  describe.skipIf(
    envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === undefined ||
      envValue("XIAOMI_TOKEN_PLAN_SGP_API_KEY") === "",
  )(
    "Xiaomi MiMo Token Plan Provider (Xiaomi MiMo-V2.6-Pro via Anthropic Messages, SGP region)",
    () => {
      const llm = getModel("xiaomi-token-plan-sgp", "mimo-v2.6-pro");
      const thinkingOptions = {
        thinkingEnabled: true,
        reasoningEffort: "high",
      } satisfies StreamOptionsWithExtras;

      it("should complete basic text generation", { retry: 3 }, () =>
        Effect.runPromise(basicTextGeneration(llm)),
      );

      it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

      it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

      it("should handle thinking mode", { retry: 3 }, () => handleThinking(llm, thinkingOptions));

      it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
        multiTurn(llm, thinkingOptions),
      );
    },
  );

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Provider (Qwen3.7-Max, international)", () => {
    const llm = getModel("qwen-token-plan", "qwen3.7-max");
    const thinkingOptions = {
      thinkingEnabled: true,
      reasoningEffort: "high",
    } satisfies StreamOptionsWithExtras;

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

    it("should handle thinking mode", { retry: 3 }, () => handleThinking(llm, thinkingOptions));

    it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
      multiTurn(llm, thinkingOptions),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_API_KEY") === undefined || envValue("QWEN_TOKEN_PLAN_API_KEY") === "",
  )("Qwen Token Plan Individual Provider (Qwen3.8-Max, international)", () => {
    const llm = getModel("qwen-token-plan-individual", "qwen3.8-max");
    const thinkingOptions = {
      thinkingEnabled: true,
      reasoningEffort: "high",
    } satisfies StreamOptionsWithExtras;

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

    it("should handle thinking mode", { retry: 3 }, () => handleThinking(llm, thinkingOptions));

    it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
      multiTurn(llm, thinkingOptions),
    );
  });

  describe.skipIf(
    envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === undefined ||
      envValue("QWEN_TOKEN_PLAN_CN_API_KEY") === "",
  )("Qwen Token Plan Provider (Qwen3.7-Max, CN region)", () => {
    const llm = getModel("qwen-token-plan-cn", "qwen3.7-max");
    const thinkingOptions = {
      thinkingEnabled: true,
      reasoningEffort: "high",
    } satisfies StreamOptionsWithExtras;

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

    it("should handle thinking mode", { retry: 3 }, () => handleThinking(llm, thinkingOptions));

    it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
      multiTurn(llm, thinkingOptions),
    );
  });

  describe.skipIf(
    envValue("ANT_LING_API_KEY") === undefined || envValue("ANT_LING_API_KEY") === "",
  )("Ant Ling Provider (Ling 2.6 Flash via OpenAI Completions)", () => {
    const llm = getModel("ant-ling", "Ling-2.6-flash");

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

    it("should handle thinking mode", { retry: 3 }, () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const ringModel = getModel("ant-ling", "Ring-2.6-1T");
          yield* Effect.promise(() => handleThinking(ringModel, { reasoningEffort: "high" }));
        }),
      ),
    );
  });

  describe("Anthropic OAuth Provider (claude-sonnet-4-6)", () => {
    const model = getModel("anthropic", "claude-sonnet-4-6");

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should complete basic text generation",
      { retry: 3 },
      () => Effect.runPromise(basicTextGeneration(model, { apiKey: anthropicOAuthToken })),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle tool calling",
      { retry: 3 },
      () => handleToolCall(model, { apiKey: anthropicOAuthToken }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle streaming",
      { retry: 3 },
      () => handleStreaming(model, { apiKey: anthropicOAuthToken }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle thinking",
      { retry: 3 },
      () => handleThinking(model, { apiKey: anthropicOAuthToken, thinkingEnabled: true }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle multi-turn with thinking and tools",
      { retry: 3 },
      () => multiTurn(model, { apiKey: anthropicOAuthToken, thinkingEnabled: true }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle image input",
      { retry: 3 },
      () => Effect.runPromise(handleImage(model, { apiKey: anthropicOAuthToken })),
    );
  });

  describe("Anthropic OAuth Provider (claude-opus-4-6 with adaptive thinking)", () => {
    const model = getModel("anthropic", "claude-opus-4-6");

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should complete basic text generation",
      { retry: 3 },
      () => Effect.runPromise(basicTextGeneration(model, { apiKey: anthropicOAuthToken })),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle tool calling",
      { retry: 3 },
      () => handleToolCall(model, { apiKey: anthropicOAuthToken }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle streaming",
      { retry: 3 },
      () => handleStreaming(model, { apiKey: anthropicOAuthToken }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle adaptive thinking with effort high",
      { retry: 3 },
      () =>
        handleThinking(model, {
          apiKey: anthropicOAuthToken,
          thinkingEnabled: true,
          effort: "high",
        }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle adaptive thinking with effort medium",
      { retry: 3 },
      () =>
        handleThinking(model, {
          apiKey: anthropicOAuthToken,
          thinkingEnabled: true,
          effort: "medium",
        }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle multi-turn with adaptive thinking and tools",
      { retry: 3 },
      () =>
        multiTurn(model, {
          apiKey: anthropicOAuthToken,
          thinkingEnabled: true,
          effort: "high",
        }),
    );

    it.skipIf(anthropicOAuthToken === undefined || anthropicOAuthToken === "")(
      "should handle image input",
      { retry: 3 },
      () => Effect.runPromise(handleImage(model, { apiKey: anthropicOAuthToken })),
    );
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

  describe.skipIf(!hasBedrockCredentials())("Amazon Bedrock Provider (claude-sonnet-4-5)", () => {
    const llm = getModel("amazon-bedrock", "global.anthropic.claude-sonnet-4-5-20250929-v1:0");

    it("should complete basic text generation", { retry: 3 }, () =>
      Effect.runPromise(basicTextGeneration(llm)),
    );

    it("should handle tool calling", { retry: 3 }, () => handleToolCall(llm));

    it("should handle streaming", { retry: 3 }, () => handleStreaming(llm));

    it("should handle thinking", { retry: 3 }, () => handleThinking(llm, { reasoning: "medium" }));

    it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
      multiTurn(llm, { reasoning: "high" }),
    );

    it("should handle image input", { retry: 3 }, () => Effect.runPromise(handleImage(llm)));
  });

  describe.skipIf(!hasBedrockCredentials())(
    "Amazon Bedrock Provider (claude-opus-4-6 interleaved thinking)",
    () => {
      const llm = getModel("amazon-bedrock", "global.anthropic.claude-opus-4-6-v1");

      it("should use adaptive thinking without anthropic_beta", { retry: 3 }, () =>
        Effect.runPromise(
          Effect.gen(function* () {
            let capturedPayload: unknown;
            const currentTime = yield* Clock.currentTimeMillis;
            const response = yield* Effect.promise(() =>
              complete(
                llm,
                {
                  systemPrompt: "You are a helpful assistant that uses tools when asked.",
                  messages: [
                    {
                      role: "user",
                      content: "Think first, then calculate 15 + 27 using the math_operation tool.",
                      timestamp: currentTime,
                    },
                  ],
                  tools: [calculatorTool],
                },
                {
                  reasoning: "xhigh",
                  interleavedThinking: true,
                  onPayload: (payload) => {
                    capturedPayload = payload;
                  },
                },
              ),
            );

            expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
            expect(capturedPayload).toBeTruthy();

            const payload = capturedPayload as {
              additionalModelRequestFields?: {
                thinking?: { type?: string; display?: string };
                output_config?: { effort?: string };
                anthropic_beta?: string[];
              };
            };

            expect(payload.additionalModelRequestFields?.thinking).toEqual({
              type: "adaptive",
              display: "summarized",
            });
            expect(payload.additionalModelRequestFields?.output_config).toEqual({ effort: "max" });
            expect(payload.additionalModelRequestFields?.anthropic_beta).toBeUndefined();
          }),
        ),
      );

      it("should pass requestMetadata to the SDK payload", { retry: 3 }, () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llmSonnet = getModel(
              "amazon-bedrock",
              "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
            );
            let capturedPayload: unknown;
            const metadata = { app: "msa-test", env: "ci" };
            const currentTime1 = yield* Clock.currentTimeMillis;
            const response = yield* Effect.promise(() =>
              complete(
                llmSonnet,
                {
                  messages: [
                    {
                      role: "user",
                      content: "Say hi.",
                      timestamp: currentTime1,
                    },
                  ],
                },
                {
                  requestMetadata: metadata,
                  onPayload: (payload) => {
                    capturedPayload = payload;
                  },
                },
              ),
            );

            expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
            expect(capturedPayload).toBeTruthy();
            expect((capturedPayload as { requestMetadata?: unknown }).requestMetadata).toEqual(
              metadata,
            );
          }),
        ),
      );

      it("should omit requestMetadata from payload when not provided", { retry: 3 }, () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const llmSonnet = getModel(
              "amazon-bedrock",
              "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
            );
            let capturedPayload: unknown;
            const currentTime2 = yield* Clock.currentTimeMillis;
            const response = yield* Effect.promise(() =>
              complete(
                llmSonnet,
                {
                  messages: [
                    {
                      role: "user",
                      content: "Say hi.",
                      timestamp: currentTime2,
                    },
                  ],
                },
                {
                  onPayload: (payload) => {
                    capturedPayload = payload;
                  },
                },
              ),
            );

            expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
            expect(capturedPayload).toBeTruthy();
            expect("requestMetadata" in (capturedPayload as object)).toBe(false);
          }),
        ),
      );
    },
  );

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
