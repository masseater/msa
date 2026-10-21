import type codingAgentTypes from "@msa/coding-agent/index.types";

import auth from "./auth.ts";
import stream from "./stream.ts";

const { loginAnthropic, refreshAnthropicToken } = auth;
const { streamCustomAnthropic } = stream;

export default function (msa: codingAgentTypes.ExtensionAPI) {
  msa.registerProvider("custom-anthropic", {
    api: "custom-anthropic-api",
    apiKey: "$CUSTOM_ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com",
    models: [
      {
        contextWindow: 200000,
        cost: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
        id: "claude-opus-4-5",
        input: ["text", "image"],
        maxTokens: 64000,
        name: "Claude Opus 4.5 (Custom)",
        reasoning: true,
      },
      {
        contextWindow: 200000,
        cost: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
        id: "claude-sonnet-4-5",
        input: ["text", "image"],
        maxTokens: 64000,
        name: "Claude Sonnet 4.5 (Custom)",
        reasoning: true,
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
