import { Clock, Effect, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { streamSimple } from "../src/compat.ts";
import modelChoice from "./model-choice.ts";

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

const omitsToolsFieldWhenContextTools = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
      const model = { ...baseModel, api: "openai-completions" } as const;

      const currentTime = yield* Clock.currentTimeMillis;
      yield* Effect.promise(() =>
        streamSimple(
          model,
          {
            messages: [{ content: "hi", role: "user", timestamp: currentTime }],
            tools: [],
          },
          { apiKey: "test" },
        ).result(),
      );

      const params = mockState.lastParams as { tools?: unknown };
      expect("tools" in (params as object)).toBe(false);
    }),
  );

const omitsToolsFieldWhenContextTools2 = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
      const model = { ...baseModel, api: "openai-completions" } as const;

      const currentTime1 = yield* Clock.currentTimeMillis;
      yield* Effect.promise(() =>
        streamSimple(
          model,
          {
            messages: [{ content: "hi", role: "user", timestamp: currentTime1 }],
          },
          { apiKey: "test" },
        ).result(),
      );

      const params = mockState.lastParams as { tools?: unknown };
      expect("tools" in (params as object)).toBe(false);
    }),
  );

const sendsDefaultMaxTokens = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
      const model = { ...baseModel, api: "openai-completions" } as const;

      const currentTime2 = yield* Clock.currentTimeMillis;
      yield* Effect.promise(() =>
        streamSimple(
          model,
          {
            messages: [{ content: "hi", role: "user", timestamp: currentTime2 }],
          },
          { apiKey: "test" },
        ).result(),
      );

      const params = mockState.lastParams as {
        max_tokens?: number;
        max_completion_tokens?: number;
      };
      expect(params.max_tokens).toBeUndefined();
      expect(params.max_completion_tokens).toBe(model.maxTokens);
    }),
  );

const sendsExplicitMaxTokens = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
      const model = { ...baseModel, api: "openai-completions" } as const;

      const currentTime3 = yield* Clock.currentTimeMillis;
      yield* Effect.promise(() =>
        streamSimple(
          model,
          {
            messages: [{ content: "hi", role: "user", timestamp: currentTime3 }],
          },
          { apiKey: "test", maxTokens: 1234 },
        ).result(),
      );

      const params = mockState.lastParams as {
        max_tokens?: number;
        max_completion_tokens?: number;
      };
      expect(params.max_tokens).toBeUndefined();
      expect(params.max_completion_tokens).toBe(1234);
    }),
  );

const clampsDefaultMaxTokensToRemainingContext = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
      const model = {
        ...baseModel,
        api: "openai-completions",
        contextWindow: 10000,
        maxTokens: 8000,
      } as const;

      const currentTime4 = yield* Clock.currentTimeMillis;
      yield* Effect.promise(() =>
        streamSimple(
          model,
          {
            messages: [{ content: "x".repeat(8000), role: "user", timestamp: currentTime4 }],
          },
          { apiKey: "test" },
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

describe("openai-completions empty tools handling", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastClientOptions = undefined;
  });
  it("omits tools field when context.tools is an empty array", omitsToolsFieldWhenContextTools);

  it("omits tools field when context.tools is undefined", omitsToolsFieldWhenContextTools2);
});

describe("openai-completions empty tools handling", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastClientOptions = undefined;
  });
  it("sends default maxTokens", sendsDefaultMaxTokens);
});

describe("openai-completions empty tools handling", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastClientOptions = undefined;
  });
  it("sends explicit maxTokens", sendsExplicitMaxTokens);
});

describe("openai-completions empty tools handling", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastClientOptions = undefined;
  });
  it("clamps default maxTokens to remaining context", clampsDefaultMaxTokensToRemainingContext);
});
