import { Clock, Console, Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import { complete, getEnvApiKey, getModel } from "../src/compat.ts";
import type { AssistantMessage, Context, Message, Tool, ToolCall } from "../src/types.ts";
import { envValue } from "./env.ts";
import { encodeJsonPretty } from "./json-codec.ts";

const testToolSchema = Type.Object({
  value: Type.Number({ description: "A number to double" }),
});

const testTool: Tool<typeof testToolSchema> = {
  name: "double_number",
  description: "Doubles a number and returns the result",
  parameters: testToolSchema,
};

describe.skipIf(
  envValue("OPENAI_API_KEY") === undefined ||
    envValue("OPENAI_API_KEY") === "" ||
    envValue("ANTHROPIC_API_KEY") === undefined ||
    envValue("ANTHROPIC_API_KEY") === "",
)("OpenAI Responses reasoning replay e2e", () => {
  it("skips reasoning-only history after an aborted turn", { retry: 2 }, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("openai", "gpt-5-mini");

        const apiKey = getEnvApiKey("openai");
        if (apiKey === undefined || apiKey === "") {
          throw new Error("Missing OPENAI_API_KEY");
        }

        const userMessage: Message = {
          role: "user",
          content: "Use the double_number tool to double 21.",
          timestamp: yield* Clock.currentTimeMillis,
        };

        const assistantResponse = yield* Effect.promise(() =>
          complete(
            model,
            {
              systemPrompt: "You are a helpful assistant. Use the tool.",
              messages: [userMessage],
              tools: [testTool],
            },
            {
              apiKey,
              reasoningEffort: "high",
            },
          ),
        );

        const thinkingBlock = assistantResponse.content.find(
          (block) => block.type === "thinking" && block.thinkingSignature,
        );
        if (thinkingBlock === undefined || thinkingBlock.type !== "thinking") {
          throw new Error("Missing thinking signature from OpenAI Responses");
        }

        const corruptedAssistant: AssistantMessage = {
          ...assistantResponse,
          content: [thinkingBlock],
          stopReason: "aborted",
        };

        const followUp: Message = {
          role: "user",
          content: "Say hello to confirm you can continue.",
          timestamp: yield* Clock.currentTimeMillis,
        };

        const context: Context = {
          systemPrompt: "You are a helpful assistant.",
          messages: [userMessage, corruptedAssistant, followUp],
          tools: [testTool],
        };

        const response = yield* Effect.promise(() =>
          complete(model, context, {
            apiKey,
            reasoningEffort: "high",
          }),
        );

        expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
        expect(response.errorMessage).toBeFalsy();
        expect(response.content.length).toBeGreaterThan(0);
      }),
    ),
  );

  it("handles same-provider different-model handoff with tool calls", { retry: 2 }, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const modelA = getModel("openai", "gpt-5-mini");
        const modelB = getModel("openai", "gpt-5.5");

        const apiKey = getEnvApiKey("openai");
        if (apiKey === undefined || apiKey === "") {
          throw new Error("Missing OPENAI_API_KEY");
        }

        const userMessage: Message = {
          role: "user",
          content: "Use the double_number tool to double 21.",
          timestamp: yield* Clock.currentTimeMillis,
        };

        const assistantResponse = yield* Effect.promise(() =>
          complete(
            modelA,
            {
              systemPrompt: "You are a helpful assistant. Always use the tool when asked.",
              messages: [userMessage],
              tools: [testTool],
            },
            {
              apiKey,
              reasoningEffort: "high",
            },
          ),
        );

        const toolCallBlock = assistantResponse.content.find(
          (block) => block.type === "toolCall",
        ) as ToolCall | undefined;

        if (toolCallBlock === undefined) {
          throw new Error("Missing tool call from OpenAI Responses - model did not use the tool");
        }

        const toolResult: Message = {
          role: "toolResult",
          toolCallId: toolCallBlock.id,
          toolName: toolCallBlock.name,
          content: [{ type: "text", text: "42" }],
          isError: false,
          timestamp: yield* Clock.currentTimeMillis,
        };

        const followUp: Message = {
          role: "user",
          content: "What was the result? Answer with just the number.",
          timestamp: yield* Clock.currentTimeMillis,
        };

        const context: Context = {
          systemPrompt: "You are a helpful assistant. Answer concisely.",
          messages: [userMessage, assistantResponse, toolResult, followUp],
          tools: [testTool],
        };

        let capturedPayload: any = null;
        const response = yield* Effect.promise(() =>
          complete(modelB, context, {
            apiKey,
            reasoningEffort: "high",
            onPayload: (payload) => {
              capturedPayload = payload;
            },
          }),
        );

        expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
        expect(response.errorMessage).toBeFalsy();
        expect(response.content.length).toBeGreaterThan(0);

        const input = capturedPayload?.input as any[];
        const functionCalls = input?.filter((item: any) => item.type === "function_call") || [];
        const reasoningItems = input?.filter((item: any) => item.type === "reasoning") || [];

        yield* Console.log("Payload sent to API:");
        yield* Console.log("- function_calls:", functionCalls.length);
        yield* Console.log("- reasoning items:", reasoningItems.length);
        yield* Console.log("- full input:", yield* encodeJsonPretty(input));

        const responseText = response.content
          .filter((b) => b.type === "text")
          .map((b) => (b as any).text)
          .join("");
        expect(responseText).toContain("42");
      }),
    ),
  );

  it("handles cross-provider handoff from Anthropic to OpenAI Codex", { retry: 2 }, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const anthropicModel = getModel("anthropic", "claude-sonnet-4-5");
        const codexModel = getModel("openai", "gpt-5.5");

        const anthropicApiKey = getEnvApiKey("anthropic");
        const openaiApiKey = getEnvApiKey("openai");
        if (
          anthropicApiKey === undefined ||
          anthropicApiKey === "" ||
          openaiApiKey === undefined ||
          openaiApiKey === ""
        ) {
          throw new Error("Missing API keys");
        }

        const userMessage: Message = {
          role: "user",
          content: "Use the double_number tool to double 21.",
          timestamp: yield* Clock.currentTimeMillis,
        };

        const assistantResponse = yield* Effect.promise(() =>
          complete(
            anthropicModel,
            {
              systemPrompt: "You are a helpful assistant. Always use the tool when asked.",
              messages: [userMessage],
              tools: [testTool],
            },
            {
              apiKey: anthropicApiKey,
              thinkingEnabled: true,
              thinkingBudgetTokens: 5000,
            },
          ),
        );

        const toolCallBlock = assistantResponse.content.find(
          (block) => block.type === "toolCall",
        ) as ToolCall | undefined;

        if (toolCallBlock === undefined) {
          throw new Error("Missing tool call from Anthropic - model did not use the tool");
        }

        yield* Console.log("Anthropic tool call ID:", toolCallBlock.id);

        const toolResult: Message = {
          role: "toolResult",
          toolCallId: toolCallBlock.id,
          toolName: toolCallBlock.name,
          content: [{ type: "text", text: "42" }],
          isError: false,
          timestamp: yield* Clock.currentTimeMillis,
        };

        const followUp: Message = {
          role: "user",
          content: "What was the result? Answer with just the number.",
          timestamp: yield* Clock.currentTimeMillis,
        };

        const context: Context = {
          systemPrompt: "You are a helpful assistant. Answer concisely.",
          messages: [userMessage, assistantResponse, toolResult, followUp],
          tools: [testTool],
        };

        let capturedPayload: any = null;
        const response = yield* Effect.promise(() =>
          complete(codexModel, context, {
            apiKey: openaiApiKey,
            reasoningEffort: "high",
            onPayload: (payload) => {
              capturedPayload = payload;
            },
          }),
        );

        const input = capturedPayload?.input as any[];
        const functionCalls = input?.filter((item: any) => item.type === "function_call") || [];
        const reasoningItems = input?.filter((item: any) => item.type === "reasoning") || [];

        yield* Console.log("Payload sent to Codex:");
        yield* Console.log("- function_calls:", functionCalls.length);
        yield* Console.log("- reasoning items:", reasoningItems.length);
        if (functionCalls.length > 0) {
          yield* Console.log(
            "- function_call IDs:",
            functionCalls.map((fc: any) => fc.id),
          );
        }

        expect(response.stopReason, `Error: ${response.errorMessage}`).not.toBe("error");
        expect(response.errorMessage).toBeFalsy();
        expect(response.content.length).toBeGreaterThan(0);

        const responseText = response.content
          .filter((b) => b.type === "text")
          .map((b) => (b as any).text)
          .join("");
        expect(responseText).toContain("42");
      }),
    ),
  );
});
