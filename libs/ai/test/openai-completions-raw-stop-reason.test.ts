import { Effect, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import openaiCompletions from "../src/api/openai-completions.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import transcript from "../src/utils/transcript.ts";

const { normalizeContext } = transcript;
const { currentTimeMillis } = clock;
const { stream: streamOpenAICompletions } = openaiCompletions;

const mockState = vi.hoisted(() => ({
  chunks: [] as unknown[],
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: () => {
          const chunks = mockState.chunks;
          const stream = {
            [Symbol.asyncIterator]() {
              return Stream.toAsyncIterable(
                Stream.fromIterable(
                  (function* () {
                    for (const chunk of chunks) yield chunk;
                  })(),
                ),
              )[Symbol.asyncIterator]();
            },
          };
          const promise = Promise.resolve(stream) as Promise<typeof stream> & {
            withResponse: () => Promise<{
              data: typeof stream;
              response: { status: number; headers: Headers };
            }>;
          };
          promise.withResponse = () =>
            Promise.resolve({
              data: stream,
              response: { headers: new Headers(), status: 200 },
            });
          return promise;
        },
      },
    };
  }
  return { default: FakeOpenAI };
});

const model: typesModule.Model<"openai-completions"> = {
  api: "openai-completions",
  baseUrl: "https://api.openai.com/v1",
  contextWindow: 128_000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "test-model",
  input: ["text"],
  maxTokens: 4096,
  name: "Test Model",
  provider: "openai",
  reasoning: false,
};

const context = normalizeContext({
  messages: [{ content: "hello", role: "user", timestamp: currentTimeMillis() }],
});

describe("OpenAI completions raw stop reasons", () => {
  beforeEach(() => {
    mockState.chunks = [];
  });

  it("preserves raw finish reasons for successful stops", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        mockState.chunks = [
          { choices: [{ delta: {}, finish_reason: "stop", index: 0 }], id: "chatcmpl-1" },
        ];

        const message = yield* Effect.promise(() =>
          streamOpenAICompletions(model, context, { apiKey: "test" }).result(),
        );

        expect(message.stopReason).toBe("stop");
        expect(message.rawStopReason).toBe("stop");
        expect(message.errorMessage).toBeUndefined();
      }),
    ));

  it("preserves raw finish reasons for provider error stops", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        mockState.chunks = [
          { choices: [{ delta: {}, finish_reason: "content_filter", index: 0 }], id: "chatcmpl-2" },
        ];

        const message = yield* Effect.promise(() =>
          streamOpenAICompletions(model, context, { apiKey: "test" }).result(),
        );

        expect(message.stopReason).toBe("error");
        expect(message.rawStopReason).toBe("content_filter");
        expect(message.errorMessage).toBe("Provider finish_reason: content_filter");
      }),
    ));
});
