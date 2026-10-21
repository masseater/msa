import { Clock, Effect, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import compat from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";

const { completeSimple } = compat;

const mockState = vi.hoisted(() => ({
  chunks: [] as unknown[],
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: () => {
          const stream = {
            [Symbol.asyncIterator]() {
              return Stream.toAsyncIterable(
                Stream.fromIterable(
                  (function* () {
                    for (const chunk of mockState.chunks) yield chunk;
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
              response: { headers: new Headers({ "x-request-id": "req-1" }), status: 200 },
            });
          return promise;
        },
      },
    };
  }
  return { default: FakeOpenAI };
});

function openRouterModel(): typesModule.Model<"openai-completions"> {
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

describe("openai-completions provider stream events", () => {
  beforeEach(() => {
    mockState.chunks = [];
  });

  it("exposes provider chunks including OpenRouter metadata", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const firstChunk = {
          choices: [{ delta: { content: "hello" }, index: 0 }],
          id: "chatcmpl-1",
          model: "anthropic/claude-sonnet-4.6",
        };
        const finalChunk = {
          choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
          id: "chatcmpl-1",
          model: "anthropic/claude-sonnet-4.6",
          openrouter_metadata: { region: "iad", strategy: "direct" },
          usage: {
            completion_tokens: 2,
            cost: 0.0012,
            is_byok: false,
            prompt_tokens: 10,
            total_tokens: 12,
          },
        };
        mockState.chunks = [firstChunk, finalChunk];
        const events: unknown[] = [];

        const currentTime = yield* Clock.currentTimeMillis;
        const message = yield* Effect.promise(() =>
          completeSimple(
            openRouterModel(),
            { messages: [{ content: "hi", role: "user", timestamp: currentTime }] },
            {
              apiKey: "test",
              onProviderStreamEvent: (data) => {
                events.push(data);
              },
            },
          ),
        );

        expect(message.content).toEqual([{ text: "hello", type: "text" }]);
        expect(events).toEqual([firstChunk, finalChunk]);
      }),
    ));
});
