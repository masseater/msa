import { Clock, Effect } from "effect";
import { Type } from "typebox";
import { expect, inject } from "vite-plus/test";

import { completeSimple, getEnvApiKey } from "../src/compat.ts";
import type { Api, AssistantMessage, Message, Model, Tool } from "../src/types.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { hasValue } = env;
const { chooseModel, usesApi } = modelChoice;

const openaiKey = getEnvApiKey("openai");
const openrouterKey = getEnvApiKey("openrouter");
const codexToken = inject("storedApiKeys")["openai-codex"];

const openaiModel = chooseModel("openai", "Responses", usesApi("openai-responses"));
const openrouterModel = chooseModel(
  "openrouter",
  "OpenAI-family completions",
  (model): model is Model<"openai-completions"> =>
    usesApi("openai-completions")(model) && model.id.startsWith("openai/"),
);
const codexModel = chooseModel("openai-codex", "Codex");

const echoToolSchema = Type.Object({
  message: Type.String({ description: "Message to echo back" }),
});

const echoTool: Tool<typeof echoToolSchema> = {
  description: "Echoes the message back",
  name: "echo",
  parameters: echoToolSchema,
};

const replyAfterToolResult = (model: Model<Api>, apiKey: string | undefined, messages: Message[]) =>
  Effect.promise(() =>
    completeSimple(
      model,
      { messages, systemPrompt: "You are a helpful assistant.", tools: [echoTool] },
      { apiKey },
    ),
  );

const echoThroughOpenAI = Effect.fn("echoThroughOpenAI")(function* (text: string) {
  const userMessage: Message = {
    content: `Use the echo tool to echo '${text}'`,
    role: "user",
    timestamp: yield* Clock.currentTimeMillis,
  };
  const assistantResponse: AssistantMessage = yield* Effect.promise(() =>
    completeSimple(
      openaiModel,
      {
        messages: [userMessage],
        systemPrompt: "You are a helpful assistant. Use the echo tool when asked.",
        tools: [echoTool],
      },
      { apiKey: openaiKey },
    ),
  );
  expect(assistantResponse.stopReason, `OpenAI error: ${assistantResponse.errorMessage}`).toBe(
    "toolUse",
  );
  const toolCall = assistantResponse.content.find((content) => content.type === "toolCall");
  if (toolCall?.type !== "toolCall") throw new Error("OpenAI returned no tool call");
  const now = yield* Clock.currentTimeMillis;
  const messages: Message[] = [
    userMessage,
    assistantResponse,
    {
      content: [{ text, type: "text" }],
      isError: false,
      role: "toolResult",
      timestamp: now,
      toolCallId: toolCall.id,
      toolName: "echo",
    },
    { content: "Say hi", role: "user", timestamp: now },
  ];
  return { messages, toolCallId: toolCall.id };
});

const toolCallIdNormalizationSupport = {
  codexModel,
  codexToken,
  echoThroughOpenAI,
  echoTool,
  hasOpenAIAndCodex: hasValue(openaiKey) && hasValue(codexToken),
  hasOpenAIAndOpenRouter: hasValue(openaiKey) && hasValue(openrouterKey),
  hasOpenRouter: hasValue(openrouterKey),
  openaiModel,
  openrouterKey,
  openrouterModel,
  replyAfterToolResult,
};

export default toolCallIdNormalizationSupport;
