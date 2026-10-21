import type anthropicMessagesCompatTypes from "./anthropic-messages-compat.types.ts";
import type anthropicMessagesOptionsTypes from "./anthropic-messages-options.ts";

declare namespace anthropicMessagesTypes {
  type AnthropicEffort = anthropicMessagesCompatTypes.AnthropicEffort;

  type AnthropicThinkingDisplay = anthropicMessagesCompatTypes.AnthropicThinkingDisplay;

  type AnthropicOptions = anthropicMessagesOptionsTypes.AnthropicOptions;
}

export type { anthropicMessagesTypes as default };
