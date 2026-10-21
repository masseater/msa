import type compatFieldsSchemaTypes from "../providers/compat-fields-schema.types.ts";
import type compatSchemaTypes from "../providers/compat-schema.types.ts";
import type modelSchemaTypes from "../providers/model-schema.types.ts";
import type openaiCompatSchemaTypes from "../providers/openai-compat-schema.types.ts";
import type routingSchemaTypes from "../providers/routing-schema.types.ts";

declare namespace aiTypesSchemaKitTypes {
  type ChatTemplateKwargValue = compatFieldsSchemaTypes.ChatTemplateKwargValue;
  type SessionAffinityFormat = compatFieldsSchemaTypes.SessionAffinityFormat;
  type ThinkingTokenBudgetField = compatFieldsSchemaTypes.ThinkingTokenBudgetField;
  type AnthropicMessagesCompat = compatSchemaTypes.AnthropicMessagesCompat;
  type CacheRetention = modelSchemaTypes.CacheRetention;
  type ModelCost = modelSchemaTypes.ModelCost;
  type ModelCostRates = modelSchemaTypes.ModelCostRates;
  type ModelCostTier = modelSchemaTypes.ModelCostTier;
  type ModelImageInputLimits = modelSchemaTypes.ModelImageInputLimits;
  type ModelImageResizeOptions = modelSchemaTypes.ModelImageResizeOptions;
  type ModelInputLimits = modelSchemaTypes.ModelInputLimits;
  type ModelInputModality = modelSchemaTypes.ModelInputModality;
  type ModelPromptCache = modelSchemaTypes.ModelPromptCache;
  type ModelThinkingLevel = modelSchemaTypes.ModelThinkingLevel;
  type ThinkingLevel = modelSchemaTypes.ThinkingLevel;
  type ThinkingLevelMap = modelSchemaTypes.ThinkingLevelMap;
  type OpenAICompletionsCompat = openaiCompatSchemaTypes.OpenAICompletionsCompat;
  type OpenAIResponsesCompat = openaiCompatSchemaTypes.OpenAIResponsesCompat;
  type AnthropicAllowedFallbackModel = routingSchemaTypes.AnthropicAllowedFallbackModel;
  type OpenRouterRouting = routingSchemaTypes.OpenRouterRouting;
}

export type { aiTypesSchemaKitTypes as default };
