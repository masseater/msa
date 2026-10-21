import type OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPartText,
  ChatCompletionDeveloperMessageParam,
  ChatCompletionSystemMessageParam,
} from "openai/resources/chat/completions.js";

import type typesModule from "../types.types.ts";
import type openaiCompletionsTypes from "./openai-completions-types.ts";

declare namespace openaiCompletionsTypesModule {
  interface OpenAICompletionsOptions extends typesModule.StreamOptions {
    toolChoice?: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined;
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined;
    thinkingBudgets?: typesModule.ThinkingBudgets | undefined;
  }

  type ResolvedOpenAICompletionsCompat = Omit<
    Required<typesModule.OpenAICompletionsCompat>,
    | "cacheControlFormat"
    | "supportsThinkingTokenBudget"
    | "thinkingTokenBudgetField"
    | "supportsMidConvoSystemMessages"
    | "supportsMidConvoToolAdditions"
    | "vllmPriority"
  > & {
    cacheControlFormat?: typesModule.OpenAICompletionsCompat["cacheControlFormat"];
    supportsThinkingTokenBudget?: typesModule.OpenAICompletionsCompat["supportsThinkingTokenBudget"];
    thinkingTokenBudgetField?: typesModule.OpenAICompletionsCompat["thinkingTokenBudgetField"];
    supportsMidConvoSystemMessages?: typesModule.OpenAICompletionsCompat["supportsMidConvoSystemMessages"];
    supportsMidConvoToolAdditions?: typesModule.OpenAICompletionsCompat["supportsMidConvoToolAdditions"];
    vllmPriority?: typesModule.OpenAICompletionsCompat["vllmPriority"];
  };

  interface OpenAICompatCacheControl {
    type: "ephemeral";
    ttl?: string;
  }

  type ResolvedChatTemplateKwargValue = string | number | boolean | null;

  type ChatCompletionInstructionMessageParam =
    | ChatCompletionDeveloperMessageParam
    | ChatCompletionSystemMessageParam;

  type OpenAIReasoningDetailBase = Record<string, typesModule.JsonValue> & {
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

  type OpenAICompletionsReasoningField =
    (typeof openaiCompletionsTypes.OPENAI_COMPLETIONS_REASONING_FIELDS)[number];

  type ChatCompletionAssistantMessageParamWithReasoning = ChatCompletionAssistantMessageParam &
    Partial<Record<OpenAICompletionsReasoningField, string>> & {
      reasoning_details?: typesModule.JsonValue[];
    };

  type ChatCompletionTextPartWithCacheControl = ChatCompletionContentPartText & {
    cache_control?: OpenAICompatCacheControl;
  };

  type ChatCompletionToolWithCacheControl = OpenAI.Chat.Completions.ChatCompletionTool & {
    cache_control?: OpenAICompatCacheControl;
  };
}

export type { openaiCompletionsTypesModule as default };
