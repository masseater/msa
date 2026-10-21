import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import openaiResponses from "../src/api/openai-responses.ts";
import type typesModule from "../src/types.types.ts";
import transcript from "../src/utils/transcript.ts";
import jsonCodec from "./json-codec.ts";

const { normalizeContext } = transcript;
const { stream: streamOpenAIResponses } = openaiResponses;

const { encodeJson } = jsonCodec;

const usageLimitError = {
  code: "subscription_sharing_usage_limit_exceeded",
  message: "Usage limit reached.",
};

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

const getErrorMessage = Effect.fn("getErrorMessage")(function* (response: Response) {
  const result = yield* Effect.promise(() =>
    streamOpenAIResponses(model, context, {
      apiKey: "test",
      fetch: () => Promise.resolve(response),
    }).result(),
  );
  expect(result.stopReason).toBe("error");
  return result.errorMessage;
});

describe("OpenAI Responses ChatGPT usage limit", () => {
  it("links to ChatGPT usage when the request is rejected", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = new Response(
          yield* encodeJson({ error: { ...usageLimitError, type: "rate_limit_error" } }),
          {
            headers: { "content-type": "application/json" },
            status: 429,
          },
        );

        const errorMessage = yield* getErrorMessage(response);

        expect(errorMessage).toContain("subscription_sharing_usage_limit_exceeded");
        expect(errorMessage).toContain(
          "Check your ChatGPT usage: https://chatgpt.com/settings/usage",
        );
      }),
    ));

  it("links to ChatGPT usage when the stream fails", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const event = {
          response: { error: usageLimitError, id: "resp_failed", status: "failed" },
          sequence_number: 0,
          type: "response.failed",
        };
        const response = new Response(
          `event: response.failed\ndata: ${yield* encodeJson(event)}\n\n`,
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        );

        const errorMessage = yield* getErrorMessage(response);

        expect(errorMessage).toContain(
          "subscription_sharing_usage_limit_exceeded: Usage limit reached.",
        );
        expect(errorMessage).toContain(
          "Check your ChatGPT usage: https://chatgpt.com/settings/usage",
        );
      }),
    ));
});
