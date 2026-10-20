import { describe, expect, it } from "vite-plus/test";

import { convertResponsesMessages } from "../src/api/openai-responses-messages.ts";
import { normalizeContext } from "../src/compat.ts";
import type { AssistantMessage, ToolResultMessage, Usage } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel } = modelChoice;

const usage: Usage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

function buildEmptyToolResult(toolCallId: string, timestamp: number): ToolResultMessage {
  return {
    content: [{ text: "", type: "text" }],
    isError: false,
    role: "toolResult",
    timestamp,
    toolCallId,
    toolName: "bash",
  };
}

describe("OpenAI Responses convertResponsesMessages empty tool result", () => {
  it("uses '(no tool output)' placeholder for empty tool results without images", () => {
    const model = chooseModel("openai", "direct OpenAI");
    const now = currentTimeMillis();
    const assistant: AssistantMessage = {
      api: model.api,
      content: [{ arguments: { command: "true" }, id: "tool-1", name: "bash", type: "toolCall" }],
      model: model.id,
      provider: model.provider,
      role: "assistant",
      stopReason: "toolUse",
      timestamp: now,
      usage,
    };

    const context = normalizeContext({
      messages: [
        { content: "Run the command", role: "user", timestamp: now - 1 },
        assistant,
        buildEmptyToolResult("tool-1", now + 1),
      ],
    });

    const input = convertResponsesMessages(
      model,
      context,
      new Set(["openai", "openai-codex", "opencode"]),
    );
    const functionCallOutput = input.find((item) => item.type === "function_call_output") as
      | { type: "function_call_output"; output: string }
      | undefined;

    expect(functionCallOutput).toBeTruthy();
    expect(functionCallOutput?.output).toBe("(no tool output)");
    expect(functionCallOutput?.output).not.toContain("see attached image");
  });
});
