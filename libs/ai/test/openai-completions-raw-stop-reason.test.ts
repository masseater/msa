import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import type { Model } from "../src/types.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

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
            async *[Symbol.asyncIterator]() {
              for (const chunk of chunks) yield chunk;
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
              response: { status: 200, headers: new Headers() },
            });
          return promise;
        },
      },
    };
  }
  return { default: FakeOpenAI };
});

const model: Model<"openai-completions"> = {
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 4096,
};

const context = normalizeContext({
  messages: [{ role: "user", content: "hello", timestamp: currentTimeMillis() }],
});

describe("OpenAI completions raw stop reasons", () => {
  beforeEach(() => {
    mockState.chunks = [];
  });

  it("preserves raw finish reasons for successful stops", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        mockState.chunks = [
          { id: "chatcmpl-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
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
          { id: "chatcmpl-2", choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }] },
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
