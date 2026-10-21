import type {
  ChatCompletionContentPartText,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions.js";

import type typesModule from "../types.types.ts";
import sanitizeUnicode from "../utils/sanitize-unicode.ts";
import constrainedSampling from "./constrained-sampling.ts";
import openaiCompletionsConvertState from "./openai-completions-convert-state.ts";
import type openaiCompletionsConvertStateTypes from "./openai-completions-convert-state.types.ts";
import openaiCompletionsReasoning from "./openai-completions-reasoning.ts";
import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";

const { isTextContentBlock, isThinkingContentBlock, isToolCallBlock } =
  openaiCompletionsConvertState;
const { sanitizeSurrogates } = sanitizeUnicode;
const {
  isOpenAICompletionsReasoningField,
  parseLegacyEncryptedReasoningDetail,
  parseOpenAIReasoningDetails,
} = openaiCompletionsReasoning;
const { getGrammarToolInput } = constrainedSampling;

type AssistantMessage = Extract<typesModule.Message, { role: "assistant" }>;

function assistantTextParts(msg: AssistantMessage): ChatCompletionContentPartText[] {
  return msg.content
    .filter(isTextContentBlock)
    .filter((block) => block.text.trim().length > 0)
    .map(
      (block) =>
        ({
          text: sanitizeSurrogates(block.text),
          type: "text",
        }) satisfies ChatCompletionContentPartText,
    );
}

interface AssistantReasoning {
  readonly thinkingBlocks: typesModule.ThinkingContent[];
  readonly toolCalls: typesModule.ToolCall[];
  readonly preservedReasoningDetails:
    | openaiCompletionsTypesModule.OpenAIReasoningDetail[]
    | undefined;
}

function collectAssistantReasoning(msg: AssistantMessage): AssistantReasoning {
  const thinkingBlocks = msg.content.filter(isThinkingContentBlock);
  const toolCalls = msg.content.filter(isToolCallBlock);
  const signedReasoningDetails = thinkingBlocks
    .map((block) => parseOpenAIReasoningDetails(block.thinkingSignature))
    .find((details) => details !== undefined);
  const legacyReasoningDetails = toolCalls
    .map((toolCall) => parseLegacyEncryptedReasoningDetail(toolCall.thoughtSignature))
    .filter(
      (detail): detail is openaiCompletionsTypesModule.OpenAIEncryptedReasoningDetail =>
        detail !== undefined,
    );
  const preservedReasoningDetails =
    signedReasoningDetails ??
    (legacyReasoningDetails.length > 0 ? legacyReasoningDetails : undefined);
  return { preservedReasoningDetails, thinkingBlocks, toolCalls };
}

function applyThinkingText(
  assistantMsg: openaiCompletionsTypesModule.ChatCompletionAssistantMessageParamWithReasoning,
  textParts: ChatCompletionContentPartText[],
  thinkingBlocks: typesModule.ThinkingContent[],
): void {
  const thinkingText = thinkingBlocks
    .map((block) => sanitizeSurrogates(block.thinking))
    .join("\n\n");
  assistantMsg.content = [{ text: thinkingText, type: "text" }, ...textParts];
}

function applyThinkingSignature(
  state: openaiCompletionsConvertStateTypes.ConvertState,
  assistantMsg: openaiCompletionsTypesModule.ChatCompletionAssistantMessageParamWithReasoning,
  thinkingBlocks: typesModule.ThinkingContent[],
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
  state: openaiCompletionsConvertStateTypes.ConvertState,
  assistantMsg: openaiCompletionsTypesModule.ChatCompletionAssistantMessageParamWithReasoning,
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

function toToolCall(
  state: openaiCompletionsConvertStateTypes.ConvertState,
  toolCall: typesModule.ToolCall,
): ChatCompletionMessageToolCall {
  const customInputProperty = state.options?.grammarToolInputProperties?.get(toolCall.name);
  if (customInputProperty !== undefined) {
    return {
      custom: {
        input: sanitizeSurrogates(
          getGrammarToolInput(toolCall.name, toolCall.arguments, customInputProperty),
        ),
        name: toolCall.name,
      },
      id: toolCall.id,
      type: "custom",
    };
  }
  return {
    function: {
      arguments: JSON.stringify(toolCall.arguments),
      name: toolCall.name,
    },
    id: toolCall.id,
    type: "function",
  };
}

function hasAssistantContent(
  assistantMsg: openaiCompletionsTypesModule.ChatCompletionAssistantMessageParamWithReasoning,
): boolean {
  const content = assistantMsg.content;
  if (content !== null && content !== undefined) {
    if (typeof content === "string" ? content.length > 0 : content.length > 0) return true;
  }
  return assistantMsg.tool_calls !== undefined;
}

function buildAssistantMessage(input: {
  state: openaiCompletionsConvertStateTypes.ConvertState;
  msg: AssistantMessage;
}): openaiCompletionsTypesModule.ChatCompletionAssistantMessageParamWithReasoning | undefined {
  const { state, msg } = input;
  const assistantMsg: openaiCompletionsTypesModule.ChatCompletionAssistantMessageParamWithReasoning =
    {
      content: state.compat.requiresAssistantAfterToolResult ? "" : null,
      role: "assistant",
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

const openaiCompletionsAssistant = {
  buildAssistantMessage,
};

export default openaiCompletionsAssistant;
