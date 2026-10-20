import type anthropicMessagesTypes from "./api/anthropic-messages.types.ts";
import type googleGenerativeAiTypes from "./api/google-generative-ai.types.ts";

declare namespace apiOptionsVendorTypes {
  interface VendorApiOptionsMap {
    "anthropic-messages": anthropicMessagesTypes.AnthropicOptions;
    "google-generative-ai": googleGenerativeAiTypes.GoogleOptions;
  }
}

export type { apiOptionsVendorTypes as default };
