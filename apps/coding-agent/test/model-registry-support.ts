import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Deferred, Effect } from "effect";

import type modelRegistrySupportTypes from "./model-registry-support.types.ts";

const { normalizeContext } = ai;
const { writeJsonFile } = testing;

const openAiModel: compatTypes.Model<compatTypes.Api> = {
  api: "openai-completions",
  baseUrl: "https://api.openai.com/v1",
  contextWindow: 128000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "test-openai-model",
  input: ["text"],
  maxTokens: 4096,
  name: "Test OpenAI Model",
  provider: "openai",
  reasoning: false,
};

const emptyContext = normalizeContext({
  messages: [],
});

const makeGate = (): modelRegistrySupportTypes.Gate => {
  const deferred = Deferred.makeUnsafe<void>();
  return {
    open: () => {
      Effect.runSync(Deferred.succeed(deferred, undefined));
    },
    promise: Deferred.await(deferred),
  };
};

const captureThrown = (run: () => void): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

function toShPath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/"/gu, '\\"');
}

const writeRawModelsJson = (modelsJsonPath: string, providers: Record<string, unknown>) =>
  writeJsonFile(modelsJsonPath, { providers });

function providerWithApiKey(apiKey: string) {
  return {
    api: "anthropic-messages",
    apiKey,
    baseUrl: "https://example.com/v1",
    models: [
      {
        contextWindow: 100000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "test-model",
        input: ["text"],
        maxTokens: 8000,
        name: "Test Model",
        reasoning: false,
      },
    ],
  };
}

const modelRegistrySupport = {
  captureThrown,
  emptyContext,
  makeGate,
  openAiModel,
  providerWithApiKey,
  toShPath,
  writeRawModelsJson,
};

export default modelRegistrySupport;
