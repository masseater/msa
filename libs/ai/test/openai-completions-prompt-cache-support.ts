import { Clock, Effect } from "effect";
import { afterEach, beforeEach, vi } from "vite-plus/test";

import openaiCompletions from "../src/api/openai-completions.ts";
import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import modelChoice from "./model-choice.ts";
import openaiCompletionsPromptCacheMock from "./openai-completions-prompt-cache-mock.ts";

const { stream: streamOpenAICompletions } = openaiCompletions;
const { normalizeContext } = compatModule;

const { chooseModel } = modelChoice;
const { mockState } = openaiCompletionsPromptCacheMock;

const openAIModel = chooseModel("openai", "direct OpenAI");

function createModel(
  overrides: Partial<typesModule.Model<"openai-completions">> = {},
): typesModule.Model<"openai-completions"> {
  const { compat: _compat, ...baseModel } = openAIModel;
  return {
    ...(baseModel as Omit<typesModule.Model<"openai-completions">, "api">),
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
  model: typesModule.Model<"openai-completions"> = createModel(),
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
