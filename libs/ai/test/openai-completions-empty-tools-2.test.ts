import { Clock, Effect, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import clock from "../src/utils/clock.ts";
import modelChoice from "./model-choice.ts";

const { streamSimple } = compatModule;
const { currentTimeMillis } = clock;

const { chooseModel } = modelChoice;

const mockState = vi.hoisted(() => ({
  lastClientOptions: undefined as unknown,
  lastParams: undefined as unknown,
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    constructor(options: unknown) {
      mockState.lastClientOptions = options;
    }

    chat = {
      completions: {
        create: (params: unknown) => {
          mockState.lastParams = params;
          const stream = {
            [Symbol.asyncIterator]() {
              return Stream.toAsyncIterable(
                Stream.fromIterable(
                  (function* () {
                    yield {
                      choices: [{ delta: {}, finish_reason: "stop" }],
                      usage: {
                        completion_tokens: 1,
                        completion_tokens_details: { reasoning_tokens: 0 },
                        prompt_tokens: 1,
                        prompt_tokens_details: { cached_tokens: 0 },
                      },
                    };
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

const clampsExplicitMaxTokensToRemainingContext = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
      const model = {
        ...baseModel,
        api: "openai-completions",
        contextWindow: 10000,
        maxTokens: 8000,
      } as const;

      const currentTime5 = yield* Clock.currentTimeMillis;
      yield* Effect.promise(() =>
        streamSimple(
          model,
          {
            messages: [{ content: "x".repeat(8000), role: "user", timestamp: currentTime5 }],
          },
          { apiKey: "test", maxTokens: 7000 },
        ).result(),
      );

      const params = mockState.lastParams as {
        max_tokens?: number;
        max_completion_tokens?: number;
      };
      expect(params.max_tokens).toBeUndefined();
      expect(params.max_completion_tokens).toBe(3618);
    }),
  );

const toolHistory = (model: typesModule.Model<"openai-completions">): typesModule.Message[] => [
  { content: "use the tool", role: "user", timestamp: currentTimeMillis() },
  {
    api: model.api,
    content: [{ arguments: {}, id: "t1", name: "noop", type: "toolCall" }],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "toolUse",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  },
  {
    content: [{ text: "done", type: "text" }],
    isError: false,
    role: "toolResult",
    timestamp: currentTimeMillis(),
    toolCallId: "t1",
    toolName: "noop",
  },
];

const stillEmitsToolsForAnthropicLiteLLM = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
      const model: typesModule.Model<"openai-completions"> = {
        ...baseModel,
        api: "openai-completions",
      };
      yield* Effect.promise(() =>
        streamSimple(
          model,
          { messages: toolHistory(model), tools: [] },
          { apiKey: "test" },
        ).result(),
      );
      const params = mockState.lastParams as { tools?: unknown[] };
      expect(params.tools).toEqual([]);
    }),
  );

describe("openai-completions empty tools handling", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastClientOptions = undefined;
  });
  it("clamps explicit maxTokens to remaining context", clampsExplicitMaxTokensToRemainingContext);
});

describe("openai-completions empty tools handling", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastClientOptions = undefined;
  });
  it(
    "still emits tools: [] for Anthropic/LiteLLM proxy when conversation has tool history",
    stillEmitsToolsForAnthropicLiteLLM,
  );
});
