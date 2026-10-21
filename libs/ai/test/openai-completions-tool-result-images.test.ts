import { describe, expect, it } from "vite-plus/test";

import openaiCompletions from "../src/api/openai-completions.ts";
import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import modelChoice from "./model-choice.ts";

const { normalizeContext } = compatModule;
const { currentTimeMillis } = clock;
const { convertMessages } = openaiCompletions;

const { chooseModel } = modelChoice;

const emptyUsage: typesModule.Usage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
};

const compat: Omit<
  Required<typesModule.OpenAICompletionsCompat>,
  "thinkingTokenBudgetField" | "vllmPriority"
> & {
  thinkingTokenBudgetField?: typesModule.OpenAICompletionsCompat["thinkingTokenBudgetField"];
} = {
  cacheControlFormat: "anthropic",
  chatTemplateKwargs: {},
  maxTokensField: "max_completion_tokens",
  openRouterRouting: {},
  requiresAssistantAfterToolResult: false,
  requiresReasoningContentOnAssistantMessages: false,
  requiresThinkingAsText: false,
  requiresToolResultName: false,
  sendSessionAffinityHeaders: false,
  sessionAffinityFormat: "openai",
  supportsDeveloperRole: true,
  supportsFinishReason: true,
  supportsLongCacheRetention: true,
  supportsMidConvoSystemMessages: false,
  supportsMidConvoToolAdditions: false,
  supportsOpenAIGrammarTools: false,
  supportsReasoningEffort: true,
  supportsStore: true,
  supportsStrictMode: true,
  supportsThinkingTokenBudget: false,
  supportsUsageInStreaming: true,
  thinkingFormat: "openai",
  thinkingTokenBudgetField: undefined,
};

function buildToolResult(toolCallId: string, timestamp: number): typesModule.ToolResultMessage {
  return {
    content: [
      { text: "Read image file [image/png]", type: "text" },
      { data: "ZmFrZQ==", mimeType: "image/png", type: "image" },
    ],
    isError: false,
    role: "toolResult",
    timestamp,
    toolCallId,
    toolName: "read",
  };
}

function buildEmptyToolResult(
  toolCallId: string,
  timestamp: number,
): typesModule.ToolResultMessage {
  return {
    content: [{ text: "", type: "text" }],
    isError: false,
    role: "toolResult",
    timestamp,
    toolCallId,
    toolName: "bash",
  };
}

describe("openai-completions convertMessages", () => {
  it("omits empty text parts from user messages with images", () => {
    const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
    const model: typesModule.Model<"openai-completions"> = {
      ...baseModel,
      api: "openai-completions",
      input: ["text", "image"],
    };
    const context = normalizeContext({
      messages: [
        {
          content: [
            { text: "", type: "text" },
            { data: "ZmFrZQ==", mimeType: "image/png", type: "image" },
          ],
          role: "user",
          timestamp: currentTimeMillis(),
        },
      ],
    });

    expect(convertMessages(model, context, compat)).toEqual([
      {
        content: [{ image_url: { url: "data:image/png;base64,ZmFrZQ==" }, type: "image_url" }],
        role: "user",
      },
    ]);
  });
});

describe("openai-completions convertMessages", () => {
  it("batches tool-result images after consecutive tool results", () => {
    const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
    const model: typesModule.Model<"openai-completions"> = {
      ...baseModel,
      api: "openai-completions",
      input: ["text", "image"],
    };

    const now = currentTimeMillis();
    const assistantMessage: typesModule.AssistantMessage = {
      api: model.api,
      content: [
        { arguments: { path: "img-1.png" }, id: "tool-1", name: "read", type: "toolCall" },
        { arguments: { path: "img-2.png" }, id: "tool-2", name: "read", type: "toolCall" },
      ],
      model: model.id,
      provider: model.provider,
      role: "assistant",
      stopReason: "toolUse",
      timestamp: now,
      usage: emptyUsage,
    };

    const context = normalizeContext({
      messages: [
        { content: "Read the images", role: "user", timestamp: now - 2 },
        assistantMessage,
        buildToolResult("tool-1", now + 1),
        buildToolResult("tool-2", now + 2),
      ],
    });

    const messages = convertMessages(model, context, compat);
    const roles = messages.map((message) => message.role);
    expect(roles).toEqual(["user", "assistant", "tool", "tool", "user"]);

    const imageMessage = messages.at(-1);
    if (imageMessage === undefined) throw new Error("Expected a converted message");
    expect(imageMessage.role).toBe("user");
    expect(Array.isArray(imageMessage.content)).toBe(true);

    const imageParts = (imageMessage.content as Array<{ type?: string }>).filter(
      (part) => part?.type === "image_url",
    );
    expect(imageParts.length).toBe(2);
  });
});

describe("openai-completions convertMessages", () => {
  it("uses '(no tool output)' placeholder for empty tool results without images", () => {
    const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
    const model: typesModule.Model<"openai-completions"> = {
      ...baseModel,
      api: "openai-completions",
      input: ["text", "image"],
    };

    const now = currentTimeMillis();
    const assistantMessage: typesModule.AssistantMessage = {
      api: model.api,
      content: [{ arguments: { command: "true" }, id: "tool-1", name: "bash", type: "toolCall" }],
      model: model.id,
      provider: model.provider,
      role: "assistant",
      stopReason: "toolUse",
      timestamp: now,
      usage: emptyUsage,
    };

    const context = normalizeContext({
      messages: [
        { content: "Run the command", role: "user", timestamp: now - 1 },
        assistantMessage,
        buildEmptyToolResult("tool-1", now + 1),
      ],
    });

    const messages = convertMessages(model, context, compat);
    const toolMessage = messages.find((m) => m.role === "tool") as
      | { role: "tool"; content: string }
      | undefined;
    expect(toolMessage).toBeTruthy();
    expect(toolMessage?.content).toBe("(no tool output)");
    expect(toolMessage?.content).not.toContain("see attached image");
  });
});
