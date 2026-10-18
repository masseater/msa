import type { Provider } from "../models.ts";
import { amazonBedrockProvider } from "./amazon-bedrock.ts";
import { azureProvider } from "./azure.ts";
import { cloudflareWorkersAIProvider } from "./cloudflare-workers-ai.ts";
import { googleVertexProvider } from "./google-vertex.ts";

export function cloudProviders(): Provider[] {
  return [
    amazonBedrockProvider(),
    azureProvider(),
    googleVertexProvider(),
    cloudflareWorkersAIProvider(),
  ];
}
