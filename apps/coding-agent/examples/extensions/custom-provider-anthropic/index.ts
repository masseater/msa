import type { ExtensionAPI } from "@msa/coding-agent";

import { loginAnthropic, refreshAnthropicToken } from "./auth.ts";
import { streamCustomAnthropic } from "./stream.ts";

export default function (msa: ExtensionAPI) {
  msa.registerProvider("custom-anthropic", {
    api: "custom-anthropic-api",
    apiKey: "$CUSTOM_ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com",
    models: [
      {
        id: "claude-opus-4-5",
        name: "Claude Opus 4.5 (Custom)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        contextWindow: 200000,
        maxTokens: 64000,
      },
      {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5 (Custom)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        contextWindow: 200000,
        maxTokens: 64000,
      },
    ],
    oauth: {
      getApiKey: (cred) => cred.access,
      login: loginAnthropic,
      name: "Custom Anthropic (Claude Pro/Max)",
      refreshToken: refreshAnthropicToken,
    },
    streamSimple: streamCustomAnthropic,
  });
}
