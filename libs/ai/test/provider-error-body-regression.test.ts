import { Effect, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import openaiCompletions from "../src/api/openai-completions.ts";
import openaiResponses from "../src/api/openai-responses.ts";
import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import openaiPermissionDeniedMock from "./openai-permission-denied-mock.ts";

const { normalizeContext } = compat;
const { stream: streamOpenAICompletions } = openaiCompletions;
const { stream: streamOpenAIResponses } = openaiResponses;

vi.mock("openai", () =>
  import("./openai-permission-denied-mock.ts").then((module) => module.default),
);

const { mockState: openaiMock } = openaiPermissionDeniedMock;

const context = normalizeContext({
  messages: [{ content: [{ text: "hi", type: "text" }], role: "user", timestamp: 0 }],
  systemPrompt: "",
  tools: [],
});

const completionsModel: typesModule.Model<"openai-completions"> = {
  api: "openai-completions",
  baseUrl: "https://openrouter.ai/api/v1",
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "test-model",
  input: ["text"],
  maxTokens: 100,
  name: "Test Model",
  provider: "openrouter",
  reasoning: false,
};

const responsesModel: typesModule.Model<"openai-responses"> = {
  api: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "gpt-test",
  input: ["text"],
  maxTokens: 100,
  name: "GPT Test",
  provider: "openai",
  reasoning: false,
};

function drainResult(stream: {
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
  result(): Promise<{ errorMessage?: string; errorStatus?: number; stopReason?: string }>;
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

        expect(output).toMatchObject({ errorStatus: 403, stopReason: "error" });
        expect(output.errorMessage).toContain("403");
        expect(output.errorMessage).toContain("blocked by gateway WAF");
        expect(output.errorMessage).not.toBe("403 status code (no body)");
      }),
    ));

  it("openai-completions does not double-print the OpenRouter metadata.raw extra", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        openaiMock.parsedBody = {
          code: 403,
          message: "Provider returned error",
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

        expect(output).toMatchObject({ errorStatus: 403, stopReason: "error" });
        expect(output.errorMessage).toContain("OpenAI API error (403)");
        expect(output.errorMessage).toContain("blocked by gateway WAF");
      }),
    ));
});
