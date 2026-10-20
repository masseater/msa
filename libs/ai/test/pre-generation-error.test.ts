import { describe, expect, it } from "vite-plus/test";

import { streamSimple as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { streamSimple as streamGoogle } from "../src/api/google-generative-ai.ts";
import { streamSimple as streamCodex } from "../src/api/openai-codex-responses.ts";
import { streamSimple as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import { streamSimple as streamOpenAIResponses } from "../src/api/openai-responses.ts";
import type { Api, AssistantMessageEventStream, Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

function model<TApi extends Api>(api: TApi): Model<TApi> {
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

function expectMissingAuthThrows(create: () => AssistantMessageEventStream): void {
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
