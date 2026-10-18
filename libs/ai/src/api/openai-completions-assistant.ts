import type {
  ChatCompletionContentPartText,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions.js";

import type { Message, ThinkingContent, ToolCall } from "../types.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { getGrammarToolInput } from "./constrained-sampling.ts";
import {
  isTextContentBlock,
  isThinkingContentBlock,
  isToolCallBlock,
  type ConvertState,
} from "./openai-completions-convert-state.ts";
import {
  isOpenAICompletionsReasoningField,
  parseLegacyEncryptedReasoningDetail,
  parseOpenAIReasoningDetails,
} from "./openai-completions-reasoning.ts";
import type {
  ChatCompletionAssistantMessageParamWithReasoning,
  OpenAIEncryptedReasoningDetail,
  OpenAIReasoningDetail,
} from "./openai-completions-types.ts";

type AssistantMessage = Extract<Message, { role: "assistant" }>;

function assistantTextParts(msg: AssistantMessage): ChatCompletionContentPartText[] {
  return msg.content
    .filter(isTextContentBlock)
    .filter((block) => block.text.trim().length > 0)
    .map(
      (block) =>
        ({
          type: "text",
          text: sanitizeSurrogates(block.text),
        }) satisfies ChatCompletionContentPartText,
    );
}

interface AssistantReasoning {
  readonly thinkingBlocks: ThinkingContent[];
  readonly toolCalls: ToolCall[];
  readonly preservedReasoningDetails: OpenAIReasoningDetail[] | undefined;
}

function collectAssistantReasoning(msg: AssistantMessage): AssistantReasoning {
  const thinkingBlocks = msg.content.filter(isThinkingContentBlock);
  const toolCalls = msg.content.filter(isToolCallBlock);
  const signedReasoningDetails = thinkingBlocks
    .map((block) => parseOpenAIReasoningDetails(block.thinkingSignature))
    .find((details) => details !== undefined);
  const legacyReasoningDetails = toolCalls
    .map((toolCall) => parseLegacyEncryptedReasoningDetail(toolCall.thoughtSignature))
    .filter((detail): detail is OpenAIEncryptedReasoningDetail => detail !== undefined);
  const preservedReasoningDetails =
    signedReasoningDetails ??
    (legacyReasoningDetails.length > 0 ? legacyReasoningDetails : undefined);
  return { thinkingBlocks, toolCalls, preservedReasoningDetails };
}

function applyThinkingText(
  assistantMsg: ChatCompletionAssistantMessageParamWithReasoning,
  textParts: ChatCompletionContentPartText[],
  thinkingBlocks: ThinkingContent[],
): void {
  const thinkingText = thinkingBlocks
    .map((block) => sanitizeSurrogates(block.thinking))
    .join("\n\n");
  assistantMsg.content = [{ type: "text", text: thinkingText }, ...textParts];
}

function applyThinkingSignature(
  state: ConvertState,
  assistantMsg: ChatCompletionAssistantMessageParamWithReasoning,
  thinkingBlocks: ThinkingContent[],
): void {
  const [firstThinkingBlock] = thinkingBlocks;
  if (firstThinkingBlock === undefined) return;
  let signature = firstThinkingBlock.thinkingSignature;
  if (state.model.provider === "opencode-go" && signature === "reasoning") {
    signature = "reasoning_content";
  }
  if (signature !== undefined && signature !== "" && isOpenAICompletionsReasoningField(signature)) {
    assistantMsg[signature] = thinkingBlocks.map((block) => block.thinking).join("\n");
  }
}

function applyThinking(
  state: ConvertState,
  assistantMsg: ChatCompletionAssistantMessageParamWithReasoning,
  textParts: ChatCompletionContentPartText[],
  assistantText: string,
  reasoning: AssistantReasoning,
): void {
  const nonEmptyThinkingBlocks = reasoning.thinkingBlocks.filter(
    (block) => block.thinking.trim().length > 0,
  );
  if (nonEmptyThinkingBlocks.length === 0) {
    if (assistantText.length > 0) {
      assistantMsg.content = assistantText;
    }
    return;
  }
  if (state.compat.requiresThinkingAsText) {
    applyThinkingText(assistantMsg, textParts, nonEmptyThinkingBlocks);
    return;
  }
  if (assistantText.length > 0) {
    assistantMsg.content = assistantText;
  }
  if (reasoning.preservedReasoningDetails !== undefined) return;
  applyThinkingSignature(state, assistantMsg, nonEmptyThinkingBlocks);
}

function toToolCall(state: ConvertState, toolCall: ToolCall): ChatCompletionMessageToolCall {
  const customInputProperty = state.options?.grammarToolInputProperties?.get(toolCall.name);
  if (customInputProperty !== undefined) {
    return {
      id: toolCall.id,
      type: "custom",
      custom: {
        name: toolCall.name,
        input: sanitizeSurrogates(
          getGrammarToolInput(toolCall.name, toolCall.arguments, customInputProperty),
        ),
      },
    };
  }
  return {
    id: toolCall.id,
    type: "function",
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  };
}

function hasAssistantContent(
  assistantMsg: ChatCompletionAssistantMessageParamWithReasoning,
): boolean {
  const content = assistantMsg.content;
  if (content !== null && content !== undefined) {
    if (typeof content === "string" ? content.length > 0 : content.length > 0) return true;
  }
  return assistantMsg.tool_calls !== undefined;
}

function buildAssistantMessage(input: {
  state: ConvertState;
  msg: AssistantMessage;
}): ChatCompletionAssistantMessageParamWithReasoning | undefined {
  const { state, msg } = input;
  const assistantMsg: ChatCompletionAssistantMessageParamWithReasoning = {
    role: "assistant",
    content: state.compat.requiresAssistantAfterToolResult ? "" : null,
  };
  const textParts = assistantTextParts(msg);
  const assistantText = textParts.map((part) => part.text).join("");
  const reasoning = collectAssistantReasoning(msg);
  applyThinking(state, assistantMsg, textParts, assistantText, reasoning);
  if (reasoning.toolCalls.length > 0) {
    assistantMsg.tool_calls = reasoning.toolCalls.map((toolCall) => toToolCall(state, toolCall));
  }
  if (reasoning.preservedReasoningDetails !== undefined) {
    assistantMsg.reasoning_details = reasoning.preservedReasoningDetails;
  }
  if (
    state.compat.requiresReasoningContentOnAssistantMessages &&
    state.model.reasoning &&
    assistantMsg.reasoning_content === undefined
  ) {
    assistantMsg.reasoning_content = "";
  }
  return hasAssistantContent(assistantMsg) ? assistantMsg : undefined;
}

export { buildAssistantMessage };
