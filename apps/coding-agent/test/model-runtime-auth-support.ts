import type { ModelRuntime } from "../src/core/model-runtime.ts";

export const authOptions = (runtime: ModelRuntime) =>
  runtime.getProviders().flatMap((provider) => {
    const oauth = provider.auth.oauth;
    const apiKey = provider.auth.apiKey;
    return [
      oauth === undefined ? undefined : { type: "oauth" as const, provider, method: oauth },
      apiKey === undefined ? undefined : { type: "api_key" as const, provider, method: apiKey },
    ].filter((option) => option !== undefined);
  });

export function testModel(id: string) {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"] as ("text" | "image")[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10000,
    maxTokens: 1000,
  };
}
