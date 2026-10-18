import { Data, Effect, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import { stream as streamOpenAIResponses } from "../src/api/openai-responses.ts";
import type { Model } from "../src/types.ts";

class FakeAPIError extends Data.TaggedError("PermissionDeniedError")<{
  readonly message: string;
  readonly status: number;
  readonly error: unknown;
}> {}

const openaiMock = vi.hoisted(() => ({
  parsedBody: { error: "blocked by gateway WAF" } as unknown,
}));

vi.mock("openai", () => {
  function throwingCreate() {
    const promise = Promise.resolve(undefined) as unknown as { withResponse: () => Promise<never> };
    promise.withResponse = () =>
      Promise.reject(
        new FakeAPIError({
          message: "403 status code (no body)",
          status: 403,
          error: openaiMock.parsedBody,
        }),
      );
    return promise;
  }
  class FakeOpenAI {
    chat = { completions: { create: throwingCreate } };
    responses = { create: throwingCreate };
  }
  return { default: FakeOpenAI };
});

import { normalizeContext } from "../src/compat.ts";

const context = normalizeContext({
  systemPrompt: "",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }],
  tools: [],
});

const completionsModel: Model<"openai-completions"> = {
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

const responsesModel: Model<"openai-responses"> = {
  id: "gpt-test",
  name: "GPT Test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

function drainResult(stream: {
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
  result(): Promise<{ errorMessage?: string; stopReason?: string }>;
}) {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(Stream.orDie, Stream.runDrain);
      return yield* Effect.promise(() => stream.result());
    }),
  );
}

describe("provider error body passthrough (per-tier regression)", () => {
  beforeEach(() => {
    openaiMock.parsedBody = { error: "blocked by gateway WAF" };
  });
  it("openai-completions (body-blind text) surfaces status + body", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const output = yield* Effect.promise(() =>
          drainResult(streamOpenAICompletions(completionsModel, context, { apiKey: "test" })),
        );

        expect(output.stopReason).toBe("error");
        expect(output.errorMessage).toContain("403");
        expect(output.errorMessage).toContain("blocked by gateway WAF");
        expect(output.errorMessage).not.toBe("403 status code (no body)");
      }),
    ));

  it("openai-completions does not double-print the OpenRouter metadata.raw extra", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        openaiMock.parsedBody = {
          message: "Provider returned error",
          code: 403,
          metadata: { raw: "upstream WAF blocked policy XYZ" },
        };

        const output = yield* Effect.promise(() =>
          drainResult(streamOpenAICompletions(completionsModel, context, { apiKey: "test" })),
        );

        expect(output.errorMessage).toContain("upstream WAF blocked policy XYZ");
        const occurrences = output.errorMessage?.match(/upstream WAF blocked policy XYZ/gu) ?? [];
        expect(occurrences).toHaveLength(1);
      }),
    ));

  it("openai-responses (status-only) keeps the prefix and surfaces the body", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const output = yield* Effect.promise(() =>
          drainResult(streamOpenAIResponses(responsesModel, context, { apiKey: "test" })),
        );

        expect(output.stopReason).toBe("error");
        expect(output.errorMessage).toContain("OpenAI API error (403)");
        expect(output.errorMessage).toContain("blocked by gateway WAF");
      }),
    ));
});
