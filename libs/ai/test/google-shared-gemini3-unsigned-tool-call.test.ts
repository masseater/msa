import { describe, expect, it } from "vite-plus/test";

import googleMessages from "../src/api/google-messages.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import transcript from "../src/utils/transcript.ts";

const { currentTimeMillis } = clock;
const { convertMessages, requiresToolCallId } = googleMessages;
const { normalizeContext } = transcript;

function makeGemini3Model<TApi extends "google-generative-ai">(
  api: TApi,
  provider: typesModule.Model<TApi>["provider"],
  id = "gemini-3-pro-preview",
): typesModule.Model<TApi> {
  return {
    api,
    baseUrl: "https://example.com",
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens: 8192,
    name: "Gemini 3 Pro Preview",
    provider,
    reasoning: true,
  };
}

const emptyUsage: typesModule.Usage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

const toolResult = (
  toolName: string,
  toolCallId: string,
  content: typesModule.ToolResultMessage["content"],
  timestamp: number,
): typesModule.ToolResultMessage => ({
  content,
  isError: false,
  role: "toolResult",
  timestamp,
  toolCallId,
  toolName,
});

function makeContext(
  model: { api: string; provider: string; id: string },
  thoughtSignature?: string,
): typesModule.Context {
  const now = currentTimeMillis();
  return {
    messages: [
      { content: "Hi", role: "user", timestamp: now },
      {
        api: model.api,
        content: [
          {
            arguments: { command: "echo hi" },
            id: "call_1",
            name: "bash",
            type: "toolCall",
            ...(thoughtSignature && { thoughtSignature }),
          },
          {
            arguments: { command: "ls -la" },
            id: "call_2",
            name: "bash",
            type: "toolCall",
          },
        ],
        model: model.id,
        provider: model.provider,
        role: "assistant",
        stopReason: "toolUse",
        timestamp: now,
        usage: emptyUsage,
      },
      toolResult("bash", "call_1", [{ text: "hi", type: "text" }], now),
      toolResult("bash", "call_2", [{ text: "files", type: "text" }], now),
    ],
  };
}

const doesNotAddSkipThoughtSignature = () => {
  const model = makeGemini3Model("google-generative-ai", "opencode");
  const contents = convertMessages(
    model,
    normalizeContext(makeContext({ ...model, id: "other-model" })),
  );

  const modelTurn = contents.find((c) => c.role === "model");
  expect(modelTurn).toBeTruthy();

  const functionCallParts = modelTurn?.parts?.filter((p) => p.functionCall !== undefined) ?? [];
  expect(functionCallParts).toHaveLength(2);
  expect(functionCallParts[0]?.thoughtSignature).toBeUndefined();
  expect(functionCallParts[1]?.thoughtSignature).toBeUndefined();
  expect(JSON.stringify(modelTurn)).not.toContain("skip_thought_signature_validator");

  const textParts = modelTurn?.parts?.filter((p) => p.text !== undefined) ?? [];
  const historicalText = textParts.filter((p) => p.text?.includes("Historical context"));
  expect(historicalText).toHaveLength(0);
};

describe("google-shared convertMessages — Gemini 3 unsigned tool calls", () => {
  it.each([
    makeGemini3Model("google-generative-ai", "opencode"),
    makeGemini3Model("google-generative-ai", "opencode", "gemini-3.6-flash"),
  ])("preserves tool call IDs for $id via $api history", (model) => {
    const context = makeContext(model);
    const contents = convertMessages(model, normalizeContext(context));
    const functionCallIds = contents
      .flatMap((content) => content.parts ?? [])
      .flatMap((part) =>
        part.functionCall?.id !== undefined && part.functionCall?.id !== ""
          ? [part.functionCall.id]
          : [],
      );
    const functionResponseIds = contents
      .flatMap((content) => content.parts ?? [])
      .flatMap((part) =>
        part.functionResponse?.id !== undefined && part.functionResponse?.id !== ""
          ? [part.functionResponse.id]
          : [],
      );

    expect(functionCallIds).toEqual(["call_1", "call_2"]);
    expect(functionResponseIds).toEqual(["call_1", "call_2"]);
  });

  it(
    "does not add skip_thought_signature_validator for unsigned Google Gen AI tool calls",
    doesNotAddSkipThoughtSignature,
  );
});

const preservesValidThoughtSignatureWhenPresentFor = () => {
  const model = makeGemini3Model("google-generative-ai", "opencode");
  const validSig = "AAAAAAAAAAAAAAAAAAAAAA==";
  const contents = convertMessages(model, normalizeContext(makeContext(model, validSig)));
  const modelTurn = contents.find((c) => c.role === "model");
  const functionCallParts = modelTurn?.parts?.filter((p) => p.functionCall !== undefined) ?? [];

  expect(functionCallParts).toHaveLength(2);
  expect(functionCallParts[0]?.thoughtSignature).toBe(validSig);
  expect(functionCallParts[1]?.thoughtSignature).toBeUndefined();
};

const doesNotAddAThoughtSignatureFor = () => {
  const model = makeGemini3Model("google-generative-ai", "opencode", "gemini-2.5-flash");
  const contents = convertMessages(
    model,
    normalizeContext(makeContext({ ...model, id: "other-model" })),
  );
  const modelTurn = contents.find((c) => c.role === "model");
  const functionCallParts =
    modelTurn?.parts?.filter((part) => part.functionCall !== undefined) ?? [];
  const functionResponseParts = contents
    .flatMap((content) => content.parts ?? [])
    .filter((part) => part.functionResponse !== undefined);

  expect(functionCallParts).toHaveLength(2);
  expect(functionCallParts.every((part) => part.functionCall?.id === undefined)).toBe(true);
  expect(functionCallParts.every((part) => part.thoughtSignature === undefined)).toBe(true);
  expect(functionResponseParts).toHaveLength(2);
  expect(functionResponseParts.every((part) => part.functionResponse?.id === undefined)).toBe(true);
};

describe("google-shared convertMessages — Gemini 3 unsigned tool calls", () => {
  it(
    "preserves valid thoughtSignature when present for the same provider and model",
    preservesValidThoughtSignatureWhenPresentFor,
  );

  it("does not add a thoughtSignature for non-Gemini-3 models", doesNotAddAThoughtSignatureFor);
});

describe("requiresToolCallId", () => {
  it.each([
    [false, "gemini-2.5-flash"],
    [true, "gemini-3.6-flash"],
    [true, "claude-sonnet-4-5"],
    [true, "gpt-oss-120b"],
  ] as const)("returns %s for %s", (expected, modelId) => {
    expect(requiresToolCallId(modelId)).toBe(expected);
  });
});
