import type { Api, ProviderStreams } from "../types.ts";
import { anthropicMessagesApi } from "./anthropic-messages.lazy.ts";
import { bedrockConverseStreamApi } from "./bedrock-converse-stream.lazy.ts";
import { googleGenerativeAIApi } from "./google-generative-ai.lazy.ts";
import { googleVertexApi } from "./google-vertex.lazy.ts";
import { mistralConversationsApi } from "./mistral-conversations.lazy.ts";
import { msaMessagesApi } from "./msa-messages.lazy.ts";

export function builtinVendorStreams(): [Api, ProviderStreams][] {
  return [
    ["anthropic-messages", anthropicMessagesApi()],
    ["google-generative-ai", googleGenerativeAIApi()],
    ["google-vertex", googleVertexApi()],
    ["mistral-conversations", mistralConversationsApi()],
    ["bedrock-converse-stream", bedrockConverseStreamApi()],
    ["msa-messages", msaMessagesApi()],
  ];
}
