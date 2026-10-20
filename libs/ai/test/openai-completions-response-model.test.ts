import { Clock, Effect, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { complete } from "../src/compat.ts";
import type { Model } from "../src/types.ts";

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

function openRouterAuto(): Model<"openai-completions"> {
  return {
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    contextWindow: 200_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "openrouter/auto",
    input: ["text"],
    maxTokens: 8192,
    name: "OpenRouter Auto",
    provider: "openrouter",
    reasoning: false,
  };
}

describe("openai-completions responseModel", () => {
  beforeEach(() => {
    mockState.chunks = [];
  });
  it("surfaces routed chunk.model on responseModel without changing model", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        mockState.chunks = [
          {
            choices: [{ delta: { content: "hi" }, index: 0 }],
            id: "chatcmpl-1",
            model: "anthropic/claude-opus-4.8",
          },
          {
            choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
            id: "chatcmpl-1",
            model: "anthropic/claude-opus-4.8",
            usage: {
              completion_tokens: 5,
              completion_tokens_details: { reasoning_tokens: 0 },
              prompt_tokens: 10,
              prompt_tokens_details: { cached_tokens: 0 },
            },
          },
        ];

        const currentTime = yield* Clock.currentTimeMillis;
        const message = yield* Effect.promise(() =>
          complete(
            openRouterAuto(),
            { messages: [{ content: "hi", role: "user", timestamp: currentTime }] },
            { apiKey: "test" },
          ),
        );

        expect(message.model).toBe("openrouter/auto");
        expect(message.responseModel).toBe("anthropic/claude-opus-4.8");
        expect(message.provider).toBe("openrouter");
        expect(message.stopReason).toBe("stop");
      }),
    ));
});

describe("openai-completions responseModel", () => {
  beforeEach(() => {
    mockState.chunks = [];
  });
  it("leaves responseModel undefined when chunks echo the requested id", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        mockState.chunks = [
          {
            choices: [{ delta: { content: "hi" }, index: 0 }],
            id: "chatcmpl-2",
            model: "openrouter/auto",
          },
          {
            choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
            id: "chatcmpl-2",
            model: "openrouter/auto",
            usage: {
              completion_tokens: 1,
              completion_tokens_details: { reasoning_tokens: 0 },
              prompt_tokens: 1,
              prompt_tokens_details: { cached_tokens: 0 },
            },
          },
        ];

        const currentTime1 = yield* Clock.currentTimeMillis;
        const message = yield* Effect.promise(() =>
          complete(
            openRouterAuto(),
            { messages: [{ content: "hi", role: "user", timestamp: currentTime1 }] },
            { apiKey: "test" },
          ),
        );

        expect(message.model).toBe("openrouter/auto");
        expect(message.responseModel).toBeUndefined();
      }),
    ));
});

describe("openai-completions responseModel", () => {
  beforeEach(() => {
    mockState.chunks = [];
  });
  it("ignores empty or missing chunk.model", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        mockState.chunks = [
          { choices: [{ delta: { content: "hi" }, index: 0 }], id: "chatcmpl-3" },
          { choices: [{ delta: { content: "!" }, index: 0 }], id: "chatcmpl-3", model: "" },
          {
            choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
            id: "chatcmpl-3",
            usage: {
              completion_tokens: 2,
              completion_tokens_details: { reasoning_tokens: 0 },
              prompt_tokens: 1,
              prompt_tokens_details: { cached_tokens: 0 },
            },
          },
        ];

        const currentTime2 = yield* Clock.currentTimeMillis;
        const message = yield* Effect.promise(() =>
          complete(
            openRouterAuto(),
            { messages: [{ content: "hi", role: "user", timestamp: currentTime2 }] },
            { apiKey: "test" },
          ),
        );

        expect(message.model).toBe("openrouter/auto");
        expect(message.responseModel).toBeUndefined();
      }),
    ));
});
