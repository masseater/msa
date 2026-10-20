import { normalizeContext } from "@msa/ai";
import type { Api, Model } from "@msa/ai/compat";
import { Deferred, Effect } from "effect";

import type modelRegistrySupportTypes from "./model-registry-support.types.ts";

const openAiModel: Model<Api> = {
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

const modelRegistrySupport = {
  captureThrown,
  emptyContext,
  makeGate,
  openAiModel,
};

export default modelRegistrySupport;
