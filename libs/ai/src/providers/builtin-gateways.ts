import type { Provider } from "../models.ts";
import { cloudflareAIGatewayProvider } from "./cloudflare-ai-gateway.ts";
import { opencodeGoProvider } from "./opencode-go.ts";
import { opencodeProvider } from "./opencode.ts";
import { openrouterProvider } from "./openrouter.ts";
import { radiusProvider } from "./radius.ts";
import { vercelAIGatewayProvider } from "./vercel-ai-gateway.ts";

export function gatewayProviders(): Provider[] {
  return [
    openrouterProvider(),
    vercelAIGatewayProvider(),
    cloudflareAIGatewayProvider(),
    opencodeProvider(),
    opencodeGoProvider(),
    radiusProvider(),
  ];
}
