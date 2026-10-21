import type anthropicMessagesCompatTypes from "../api/anthropic-messages-compat.types.ts";
import type anthropicMessagesOptionsTypes from "../api/anthropic-messages-options.ts";
import type googleGenerativeAiTypes from "../api/google-generative-ai.types.ts";
import type googleThinkingTypes from "../api/google-thinking.types.ts";
import type lazyTypes from "../api/lazy.types.ts";
import type openaiCodexOptionsTypes from "../api/openai-codex-options.types.ts";
import type openaiCodexWsStatsTypes from "../api/openai-codex-ws-stats.types.ts";
import type openaiCompletionsTypesModule from "../api/openai-completions-types.types.ts";
import type openaiResponsesConfigTypes from "../api/openai-responses-config.types.ts";

declare namespace aiApiKitTypes {
  type AnthropicEffort = anthropicMessagesCompatTypes.AnthropicEffort;
  type AnthropicOptions = anthropicMessagesOptionsTypes.AnthropicOptions;
  type AnthropicThinkingDisplay = anthropicMessagesCompatTypes.AnthropicThinkingDisplay;
  type GoogleOptions = googleGenerativeAiTypes.GoogleOptions;
  type GoogleApiThinkingLevel = googleThinkingTypes.GoogleApiThinkingLevel;
  type ResolvedGoogleThinkingLevel = googleThinkingTypes.ResolvedGoogleThinkingLevel;
  type OpenAICodexResponsesOptions = openaiCodexOptionsTypes.OpenAICodexResponsesOptions;
  type OpenAICodexWebSocketDebugStats = openaiCodexWsStatsTypes.OpenAICodexWebSocketDebugStats;
  type OpenAICompletionsOptions = openaiCompletionsTypesModule.OpenAICompletionsOptions;
  type OpenAIResponsesOptions = openaiResponsesConfigTypes.OpenAIResponsesOptions;
  type LazyApiCapabilities = lazyTypes.LazyApiCapabilities;
}

export type { aiApiKitTypes as default };
