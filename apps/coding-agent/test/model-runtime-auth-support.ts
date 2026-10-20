import type { ModelRuntime } from "../src/core/model-runtime.ts";

const authOptions = (runtime: ModelRuntime) =>
  runtime.getProviders().flatMap((provider) => {
    const oauth = provider.auth.oauth;
    const apiKey = provider.auth.apiKey;
    return [
      oauth === undefined ? undefined : { method: oauth, provider, type: "oauth" as const },
      apiKey === undefined ? undefined : { method: apiKey, provider, type: "api_key" as const },
    ].filter((option) => option !== undefined);
  });

function testModel(id: string) {
  return {
    contextWindow: 10000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"] as ("text" | "image")[],
    maxTokens: 1000,
    name: id,
    reasoning: false,
  };
}

const modelRuntimeAuthSupport = {
  authOptions,
  testModel,
};

export default modelRuntimeAuthSupport;
