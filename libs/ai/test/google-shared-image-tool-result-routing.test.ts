import { describe, expect, it } from "vite-plus/test";

import { convertMessages } from "../src/api/google-messages.ts";
import type { Context, Model, ToolResultMessage, Usage } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

function makeModel<TApi extends "google-generative-ai">(
  api: TApi,
  provider: Model<TApi>["provider"],
  id: string,
): Model<TApi> {
  return {
    api,
    baseUrl: "https://example.com",
    contextWindow: 128000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text", "image"],
    maxTokens: 8192,
    name: id,
    provider,
    reasoning: true,
  };
}

const emptyUsage: Usage = {
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
  content: ToolResultMessage["content"],
  timestamp: number,
): ToolResultMessage => ({
  content,
  isError: false,
  role: "toolResult",
  timestamp,
  toolCallId,
  toolName,
});

function makeContext(model: { api: string; provider: string; id: string }): Context {
  const now = currentTimeMillis();
  return {
    messages: [
      { content: "read the files", role: "user", timestamp: now },
      {
        api: model.api,
        content: [
          { arguments: { path: "a.txt" }, id: "call_a", name: "read", type: "toolCall" },
          { arguments: { path: "image.png" }, id: "call_img", name: "read", type: "toolCall" },
          { arguments: { path: "b.txt" }, id: "call_b", name: "read", type: "toolCall" },
        ],
        model: model.id,
        provider: model.provider,
        role: "assistant",
        stopReason: "toolUse",
        timestamp: now,
        usage: emptyUsage,
      },
      toolResult("read", "call_a", [{ text: "alpha text", type: "text" }], now),
      toolResult("read", "call_img", [{ data: "abc", mimeType: "image/png", type: "image" }], now),
      toolResult("read", "call_b", [{ text: "beta text", type: "text" }], now),
    ],
  };
}

const keepsSeparateSyntheticImageTurnFor = () => {
  const model = makeModel("google-generative-ai", "google", "gemini-2.5-flash");
  const contents = convertMessages(model, normalizeContext(makeContext(model)));

  expect(contents).toHaveLength(5);
  expect(contents[2]?.parts?.every((part) => part.functionResponse)).toBe(true);
  expect(contents[3]?.parts?.[0]?.text).toBe("Tool result image:");
  expect(contents[3]?.parts?.[1]?.inlineData).toBeTruthy();
  expect(contents[4]?.parts?.[0]?.functionResponse).toBeTruthy();
};

const nestsImageToolResultsForGemini = () => {
  const model = makeModel("google-generative-ai", "google", "gemini-3-pro-preview");
  const contents = convertMessages(model, normalizeContext(makeContext(model)));

  expect(contents).toHaveLength(3);
  const toolResultTurn = contents[2];
  expect(toolResultTurn?.parts).toHaveLength(3);
  const imageResponse = toolResultTurn?.parts?.[1]?.functionResponse;
  expect(imageResponse).toBeTruthy();
  expect(imageResponse?.parts).toHaveLength(1);
  expect(imageResponse?.parts?.[0]?.inlineData).toBeTruthy();
};

describe("google-shared image tool result routing", () => {
  it(
    "keeps separate synthetic image turn for Gemini 2.x Google API models",
    keepsSeparateSyntheticImageTurnFor,
  );

  it("nests image tool results for Gemini 3 Google API models", nestsImageToolResultsForGemini);
});
