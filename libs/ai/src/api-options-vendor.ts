import type { AnthropicOptions } from "./api/anthropic-messages.ts";
import type { BedrockOptions } from "./api/bedrock-converse-stream.ts";
import type { GoogleOptions } from "./api/google-generative-ai.ts";
import type { GoogleVertexOptions } from "./api/google-vertex.ts";
import type { MistralOptions } from "./api/mistral-conversations.ts";
import type { MsaMessagesOptions } from "./api/msa-messages.ts";

export interface VendorApiOptionsMap {
  "anthropic-messages": AnthropicOptions;
  "google-generative-ai": GoogleOptions;
  "google-vertex": GoogleVertexOptions;
  "mistral-conversations": MistralOptions;
  "bedrock-converse-stream": BedrockOptions;
  "msa-messages": MsaMessagesOptions;
}
