import { describe, expect, it } from "vite-plus/test";

import { convertResponsesMessages } from "../src/api/openai-responses-messages.ts";
import { normalizeContext } from "../src/compat.ts";
import type { AssistantMessage, ToolResultMessage, Usage } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { shortHash } from "../src/utils/hash.ts";
import modelChoice from "./model-choice.ts";

const { chooseModel } = modelChoice;

const FOREIGN_RAW_TOOL_CALL_ID =
  "call_4VnzVawQXPB9MgYib7CiQFEY|I9b95oN1wD/cHXKTw3PpRkL6KkCtzTJhUxMouMWYwHeTo2j3htzfSk7YPx2vifiIM4g3A8XXyOj8q4Bt6SLUG7gqY1E3ELkrkVQNHglRfUmWj84lqxJY+Puieb3VKyX0FB+83TUzn91cDMF/4gzt990IzqVrc+nIb9RRscRD070Du16q1glydVjWR0SBJsE6TbY/esOjFpqplogQqrajm1eI++f3eLi73R6q7hVusY0QbeFySVxABCjhN0lXB04caBe1rzHjYzul6MAXj7uq+0r17VLq+yrtyYhN12wkmFqHeqTyEei6EFPbMy24Nc+IbJlkP0OCg02W+gOnyBFcbi2ctvJFSOhSjt1CqBdqCnnhwUqXjbWiT0wh3DmLScRgTHmGkaI+oAcQQjfic65nxj+TnEkReA==";

const usage: Usage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

const hashesForeignToolItemIDsInto = () => {
  const functionCall = hashesForeignToolItemIDsIntoStep1();

  expect(functionCall).toBeDefined();
  expect(functionCall?.type).toBe("function_call");
  if (functionCall === undefined || functionCall.type !== "function_call") {
    throw new Error("Expected function_call item");
  }

  const expectedItemId = `fc_${shortHash(FOREIGN_RAW_TOOL_CALL_ID.split("|")[1]!)}`;
  expect(functionCall.id).toBe(expectedItemId);
  expect(functionCall.id?.length ?? 0).toBeLessThanOrEqual(64);
  expect(functionCall.id).toMatch(/^fc_[A-Za-z0-9]+$/u);
};

describe("OpenAI Responses foreign tool call ID normalization", () => {
  it(
    "hashes foreign tool item IDs into a bounded Codex-safe fc_<hash> shape",
    hashesForeignToolItemIDsInto,
  );
});

function hashesForeignToolItemIDsIntoStep1() {
  const model = chooseModel("openai-codex", "Codex");
  const assistant: AssistantMessage = {
    api: "openai-responses",
    content: [
      {
        arguments: { path: "src/styles/app.css" },
        id: FOREIGN_RAW_TOOL_CALL_ID,
        name: "edit",
        type: "toolCall",
      },
    ],
    model: "gpt-5.5",
    provider: "openai",
    role: "assistant",
    stopReason: "toolUse",
    timestamp: currentTimeMillis() - 2000,
    usage,
  };
  const toolResult: ToolResultMessage = {
    content: [{ text: "ok", type: "text" }],
    isError: false,
    role: "toolResult",
    timestamp: currentTimeMillis() - 1000,
    toolCallId: FOREIGN_RAW_TOOL_CALL_ID,
    toolName: "edit",
  };
  const context = normalizeContext({
    messages: [
      { content: "Use the tool.", role: "user", timestamp: currentTimeMillis() - 3000 },
      assistant,
      toolResult,
    ],
    systemPrompt: "You are concise.",
  });

  const input = convertResponsesMessages(
    model,
    context,
    new Set(["openai", "openai-codex", "opencode"]),
  );
  const functionCall = input.find((item) => item.type === "function_call");
  return functionCall;
}
