import type { Api, ProviderStreams } from "../types.ts";
import { anthropicMessagesApi } from "./anthropic-messages.lazy.ts";
import { googleGenerativeAIApi } from "./google-generative-ai.lazy.ts";

export function builtinVendorStreams(): [Api, ProviderStreams][] {
  return [
    ["anthropic-messages", anthropicMessagesApi()],
    ["google-generative-ai", googleGenerativeAIApi()],
  ];
}
