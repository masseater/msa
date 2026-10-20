import { Effect } from "effect";
import { afterAll, beforeAll, describe, inject, it } from "vite-plus/test";

import localLlmSupport from "./local-llm-support.ts";
import streamScenarios from "./stream-scenarios.ts";

const { ollamaModel, startOllama } = localLlmSupport;
const { basicTextGeneration, handleStreaming, handleThinking, handleToolCall, multiTurn } =
  streamScenarios;

const options = { apiKey: "test" };
const thinking = { ...options, reasoningEffort: "medium" };

describe.skipIf(!inject("localLlms").ollama)("Generate E2E Tests: Ollama", () => {
  const stop: { value?: () => Promise<void> } = {};
  beforeAll(() => startOllama().then((stopOllama) => (stop.value = stopOllama)), 600000);
  afterAll(() => stop.value?.());

  it("should complete basic text generation", { retry: 3 }, () =>
    Effect.runPromise(basicTextGeneration(ollamaModel, options)),
  );
  it("should handle tool calling", { retry: 3 }, () =>
    Effect.runPromise(handleToolCall(ollamaModel, options)),
  );
  it("should handle streaming", { retry: 3 }, () =>
    Effect.runPromise(handleStreaming(ollamaModel, options)),
  );
  it("should handle thinking mode", { retry: 3 }, () =>
    Effect.runPromise(handleThinking(ollamaModel, thinking)),
  );
  it("should handle multi-turn with thinking and tools", { retry: 3 }, () =>
    Effect.runPromise(multiTurn(ollamaModel, thinking)),
  );
});
