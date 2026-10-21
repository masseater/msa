import type { ResponseOutputMessage } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vite-plus/test";

import openaiResponsesMessages from "../src/api/openai-responses-messages.ts";
import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import modelChoice from "./model-choice.ts";

const { currentTimeMillis } = clock;
const { normalizeContext } = compat;
const { convertResponsesMessages } = openaiResponsesMessages;

const { chooseModel } = modelChoice;

const usage: typesModule.Usage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

describe("OpenAI Responses message ID conversion", () => {
  it("generates unique fallback message IDs for multiple text blocks in one assistant turn", () => {
    const model = chooseModel("openai-codex", "Codex");
    const assistant: typesModule.AssistantMessage = {
      api: "anthropic-messages",
      content: [
        { thinking: "private reasoning", type: "thinking" },
        { text: "visible answer", type: "text" },
      ],
      model: "claude-opus-4-8",
      provider: "anthropic-api",
      role: "assistant",
      stopReason: "stop",
      timestamp: currentTimeMillis() - 1000,
      usage,
    };
    const context = normalizeContext({
      messages: [
        { content: "hello", role: "user", timestamp: currentTimeMillis() - 2000 },
        assistant,
      ],
      systemPrompt: "You are concise.",
    });

    const input = convertResponsesMessages(
      model,
      context,
      new Set(["openai", "openai-codex", "opencode"]),
    );
    const messageIds = input
      .filter(
        (item): item is ResponseOutputMessage =>
          item.type === "message" && "id" in item && typeof item.id === "string",
      )
      .map((item) => item.id);

    expect(messageIds).toEqual(["msg_pi_1", "msg_pi_1_1"]);
    expect(new Set(messageIds).size).toBe(messageIds.length);
  });
});
