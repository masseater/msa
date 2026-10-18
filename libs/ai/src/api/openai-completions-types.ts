import type OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPartText,
  ChatCompletionDeveloperMessageParam,
  ChatCompletionSystemMessageParam,
} from "openai/resources/chat/completions.js";

import type {
  JsonValue,
  OpenAICompletionsCompat,
  StreamOptions,
  ThinkingBudgets,
} from "../types.ts";

interface OpenAICompletionsOptions extends StreamOptions {
  toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined;
  reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  thinkingBudgets?: ThinkingBudgets | undefined;
}

type ResolvedOpenAICompletionsCompat = Omit<
  Required<OpenAICompletionsCompat>,
  | "cacheControlFormat"
  | "supportsThinkingTokenBudget"
  | "thinkingTokenBudgetField"
  | "supportsMidConvoSystemMessages"
  | "supportsMidConvoToolAdditions"
  | "vllmPriority"
> & {
  cacheControlFormat?: OpenAICompletionsCompat["cacheControlFormat"];
  supportsThinkingTokenBudget?: OpenAICompletionsCompat["supportsThinkingTokenBudget"];
  thinkingTokenBudgetField?: OpenAICompletionsCompat["thinkingTokenBudgetField"];
  supportsMidConvoSystemMessages?: OpenAICompletionsCompat["supportsMidConvoSystemMessages"];
  supportsMidConvoToolAdditions?: OpenAICompletionsCompat["supportsMidConvoToolAdditions"];
  vllmPriority?: OpenAICompletionsCompat["vllmPriority"];
};

interface OpenAICompatCacheControl {
  type: "ephemeral";
  ttl?: string;
}

type ResolvedChatTemplateKwargValue = string | number | boolean | null;

type ChatCompletionInstructionMessageParam =
  | ChatCompletionDeveloperMessageParam
  | ChatCompletionSystemMessageParam;

type OpenAIReasoningDetailBase = Record<string, JsonValue> & {
  id?: string | null;
  format?: string;
  index?: number;
};

type OpenAIReasoningSummaryDetail = OpenAIReasoningDetailBase & {
  type: "reasoning.summary";
  summary: string;
};

type OpenAIEncryptedReasoningDetail = OpenAIReasoningDetailBase & {
  type: "reasoning.encrypted";
  data: string;
};

type OpenAIReasoningTextDetail = OpenAIReasoningDetailBase & {
  type: "reasoning.text";
  text: string;
  signature?: string | null;
};

type OpenAIReasoningDetail =
  | OpenAIReasoningSummaryDetail
  | OpenAIEncryptedReasoningDetail
  | OpenAIReasoningTextDetail;

const OPENAI_COMPLETIONS_REASONING_FIELDS = [
  "reasoning",
  "reasoning_content",
  "reasoning_text",
] as const;

type OpenAICompletionsReasoningField = (typeof OPENAI_COMPLETIONS_REASONING_FIELDS)[number];

type ChatCompletionAssistantMessageParamWithReasoning = ChatCompletionAssistantMessageParam &
  Partial<Record<OpenAICompletionsReasoningField, string>> & {
    reasoning_details?: JsonValue[];
  };

type ChatCompletionTextPartWithCacheControl = ChatCompletionContentPartText & {
  cache_control?: OpenAICompatCacheControl;
};

type ChatCompletionToolWithCacheControl = OpenAI.Chat.Completions.ChatCompletionTool & {
  cache_control?: OpenAICompatCacheControl;
};

export type {
  ChatCompletionAssistantMessageParamWithReasoning,
  ChatCompletionInstructionMessageParam,
  ChatCompletionTextPartWithCacheControl,
  ChatCompletionToolWithCacheControl,
  OpenAICompatCacheControl,
  OpenAICompletionsReasoningField,
  OpenAICompletionsOptions,
  OpenAIEncryptedReasoningDetail,
  OpenAIReasoningDetail,
  OpenAIReasoningDetailBase,
  OpenAIReasoningSummaryDetail,
  OpenAIReasoningTextDetail,
  ResolvedChatTemplateKwargValue,
  ResolvedOpenAICompletionsCompat,
};
export { OPENAI_COMPLETIONS_REASONING_FIELDS };
