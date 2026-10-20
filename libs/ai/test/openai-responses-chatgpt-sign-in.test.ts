import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import openaiResponses from "../src/api/openai-responses.ts";
import type typesModule from "../src/types.types.ts";
import transcript from "../src/utils/transcript.ts";

const { normalizeContext } = transcript;
const { stream: streamOpenAIResponses } = openaiResponses;

const model: typesModule.Model<"openai-responses"> = {
  api: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
  contextWindow: 400000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "gpt-5-mini",
  input: ["text"],
  maxTokens: 128000,
  name: "GPT-5 Mini",
  provider: "openai",
  reasoning: true,
};

const context = normalizeContext({
  messages: [{ content: [{ text: "hi", type: "text" }], role: "user", timestamp: 0 }],
  systemPrompt: "",
  tools: [],
});

const capturePayload = Effect.fn("capturePayload")(function* (
  apiKey: string,
  requestModel: typesModule.Model<"openai-responses"> = model,
) {
  let payload: Record<string, unknown> | undefined;
  yield* Effect.promise(() =>
    streamOpenAIResponses(requestModel, context, {
      apiKey,
      cacheRetention: "long",
      fetch: () => Promise.resolve(new Response(null, { status: 500 })),
      maxTokens: 1000,
      onPayload: (params) => {
        payload = params as Record<string, unknown>;
      },
      temperature: 0.5,
    }).result(),
  );
  if (payload === undefined) throw new Error("Request payload was not captured");
  return payload;
});

describe("OpenAI Responses with Sign in with ChatGPT", () => {
  it("omits request fields that token sharing rejects", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload("chatgpt-access-token");

        expect(payload).not.toHaveProperty("max_output_tokens");
        expect(payload).not.toHaveProperty("temperature");
        expect(payload["prompt_cache_retention"]).toBeUndefined();
      }),
    ));

  it("omits prompt_cache_options on models with explicit prompt cache mode", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const explicitCacheModel = { ...model, compat: { supportsExplicitPromptCacheMode: true } };

        const signInPayload = yield* capturePayload("chatgpt-access-token", explicitCacheModel);
        const apiKeyPayload = yield* capturePayload("sk-proj-test", explicitCacheModel);

        expect(signInPayload["prompt_cache_options"]).toBeUndefined();
        expect(apiKeyPayload["prompt_cache_options"]).toEqual({ ttl: "30m" });
      }),
    ));

  it.each([
    { apiKey: "sk-proj-test", name: "OpenAI API keys", requestModel: model },
    {
      apiKey: "gateway-key",
      name: "other OpenAI-compatible endpoints",
      requestModel: { ...model, baseUrl: "https://gateway.example.com/v1" },
    },
  ])("keeps those fields for $name", ({ apiKey, requestModel }) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* capturePayload(apiKey, requestModel);

        expect(payload["max_output_tokens"]).toBe(1000);
        expect(payload["temperature"]).toBe(0.5);
        expect(payload["prompt_cache_retention"]).toBe("24h");
      }),
    ),
  );
});
