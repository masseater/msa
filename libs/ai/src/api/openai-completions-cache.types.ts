import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

import type openaiCompletionsTypesModule from "./openai-completions-types.types.ts";
declare namespace openaiCompletionsCacheTypes {
  interface ApplyCacheControlInput {
    readonly messages: ChatCompletionMessageParam[];
    readonly tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;
    readonly cacheControl: openaiCompletionsTypesModule.OpenAICompatCacheControl;
  }
}

export type { openaiCompletionsCacheTypes as default };
