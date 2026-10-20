import { Clock, Effect } from "effect";
import { afterEach, beforeEach, vi } from "vite-plus/test";

import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import { normalizeContext } from "../src/compat.ts";
import type { Model } from "../src/types.ts";
import modelChoice from "./model-choice.ts";
import openaiCompletionsPromptCacheMock from "./openai-completions-prompt-cache-mock.ts";

const { chooseModel } = modelChoice;
const { mockState } = openaiCompletionsPromptCacheMock;

const openAIModel = chooseModel("openai", "direct OpenAI");

function createModel(
  overrides: Partial<Model<"openai-completions">> = {},
): Model<"openai-completions"> {
  const { compat: _compat, ...baseModel } = openAIModel;
  return {
    ...(baseModel as Omit<Model<"openai-completions">, "api">),
    api: "openai-completions",
    ...overrides,
  };
}

const captureRequest = Effect.fn("captureRequest")(function* (
  options?: {
    cacheRetention?: "none" | "short" | "long";
    sessionId?: string;
    headers?: Record<string, string>;
  },
  model: Model<"openai-completions"> = createModel(),
) {
  const currentTime = yield* Clock.currentTimeMillis;
  yield* Effect.promise(() =>
    streamOpenAICompletions(
      model,
      normalizeContext({
        messages: [{ content: "hi", role: "user", timestamp: currentTime }],
        systemPrompt: "sys",
      }),
      { apiKey: "test-key", ...options },
    ).result(),
  );
  return {
    headers: mockState.lastClientOptions?.defaultHeaders ?? {},
    payload: mockState.lastParams,
  };
});

const isolateCacheRetentionEnv = () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastClientOptions = undefined;
    vi.stubEnv("MSA_CACHE_RETENTION", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
};

const openaiCompletionsPromptCacheSupport = {
  captureRequest,
  createModel,
  isolateCacheRetentionEnv,
};

export default openaiCompletionsPromptCacheSupport;
