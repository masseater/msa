import { Deferred, Effect } from "effect";
export const nodeFs = process.getBuiltinModule("node:fs");

import { normalizeContext } from "@msa/ai";
import type { Api, Model } from "@msa/ai/compat";

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

export interface Gate {
  readonly promise: Effect.Effect<void>;
  open(): void;
}

export const makeGate = (): Gate => {
  const deferred = Deferred.makeUnsafe<void>();
  return {
    promise: Deferred.await(deferred),
    open: () => {
      Effect.runSync(Deferred.succeed(deferred, undefined));
    },
  };
};

export const captureThrown = (run: () => void): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};
