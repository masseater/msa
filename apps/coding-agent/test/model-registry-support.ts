import { normalizeContext } from "@msa/ai";
import { Api, Model } from "@msa/ai/compat";
import { test } from "vite-plus/test";

export const openAiModel: Model<Api> = {
  id: "test-openai-model",
  name: "Test OpenAI Model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

export const emptyContext = normalizeContext({
  messages: [],
});
