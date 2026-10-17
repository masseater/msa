import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream as streamOpenAIResponses } from "../src/api/openai-responses.ts";
import type { Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const model: Model<"openai-responses"> = {
  id: "gpt-5-mini",
  name: "GPT-5 Mini",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 400000,
  maxTokens: 128000,
};

const context = normalizeContext({
  systemPrompt: "",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }],
  tools: [],
});

const capturePayload = Effect.fn("capturePayload")(function* (
  apiKey: string,
  requestModel: Model<"openai-responses"> = model,
) {
  let payload: Record<string, unknown> | undefined;
  yield* Effect.promise(() =>
    streamOpenAIResponses(requestModel, context, {
      apiKey,
      maxTokens: 1000,
      temperature: 0.5,
      cacheRetention: "long",
      onPayload: (params) => {
        payload = params as Record<string, unknown>;
      },
      fetch: () => Promise.resolve(new Response(null, { status: 500 })),
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
    { name: "OpenAI API keys", apiKey: "sk-proj-test", requestModel: model },
    {
      name: "other OpenAI-compatible endpoints",
      apiKey: "gateway-key",
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
