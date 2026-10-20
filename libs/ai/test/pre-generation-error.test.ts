import { describe, expect, it } from "vite-plus/test";

import anthropicMessages from "../src/api/anthropic-messages.ts";
import googleGenerativeAi from "../src/api/google-generative-ai.ts";
import openaiCodexResponses from "../src/api/openai-codex-responses.ts";
import openaiCompletions from "../src/api/openai-completions.ts";
import openaiResponses from "../src/api/openai-responses.ts";
import type typesModule from "../src/types.types.ts";
import transcript from "../src/utils/transcript.ts";

const { normalizeContext } = transcript;
const { streamSimple: streamAnthropic } = anthropicMessages;
const { streamSimple: streamGoogle } = googleGenerativeAi;
const { streamSimple: streamCodex } = openaiCodexResponses;
const { streamSimple: streamOpenAICompletions } = openaiCompletions;
const { streamSimple: streamOpenAIResponses } = openaiResponses;

function model<TApi extends typesModule.Api>(api: TApi): typesModule.Model<TApi> {
  return {
    api,
    baseUrl: "https://example.invalid",
    contextWindow: 1_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "test-model",
    input: ["text"],
    maxTokens: 100,
    name: "Test",
    provider: "test-provider",
    reasoning: false,
  };
}

function expectMissingAuthThrows(create: () => typesModule.AssistantMessageEventStream): void {
  expect(create).toThrow("No API key for provider: test-provider");
}

describe("direct API authentication", () => {
  it("throws synchronously when auth is missing", () => {
    const context = normalizeContext({ messages: [] });
    expectMissingAuthThrows(() => streamAnthropic(model("anthropic-messages"), context, {}));
    expectMissingAuthThrows(() => streamGoogle(model("google-generative-ai"), context, {}));
    expectMissingAuthThrows(() => streamCodex(model("openai-codex-responses"), context, {}));
    expectMissingAuthThrows(() =>
      streamOpenAICompletions(model("openai-completions"), context, {}),
    );
    expectMissingAuthThrows(() => streamOpenAIResponses(model("openai-responses"), context, {}));
  });
});
