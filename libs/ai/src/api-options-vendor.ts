import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import type { GoogleOptions } from "./api/google-generative-ai.ts";

export interface VendorApiOptionsMap {
  "anthropic-messages": AnthropicOptions;
  "google-generative-ai": GoogleOptions;
}
