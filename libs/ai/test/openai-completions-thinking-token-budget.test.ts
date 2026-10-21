import { Clock, Effect, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";

const { streamSimple } = compatModule;

const mockState = vi.hoisted(() => ({
  lastParams: undefined as unknown,
}));

vi.mock("openai", () => {
  class FakeOpenAI {
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

type CapturedParams = {
  thinking_token_budget?: number;
  thinking_budget?: number;
  thinking_budget_tokens?: number;
  thinking?: unknown;
  chat_template_kwargs?: Record<string, unknown>;
};

function vllmModel(
  compat: typesModule.Model<"openai-completions">["compat"] = {
    supportsThinkingTokenBudget: true,
    thinkingFormat: "qwen",
  },
): typesModule.Model<"openai-completions"> {
  return {
    api: "openai-completions",
    baseUrl: "http://localhost:8000/v1",
    compat,
    contextWindow: 262144,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "Qwen/Qwen3.6-27B",
    input: ["text"],
    maxTokens: 16384,
    name: "Qwen 3.6 27B (local vLLM)",
    provider: "local-vllm",
    reasoning: true,
  };
}

const capture = Effect.fn("capture")(function* (
  model: typesModule.Model<"openai-completions">,
  options?: {
    reasoning?: typesModule.SimpleStreamOptions["reasoning"];
    thinkingBudgets?: typesModule.ThinkingBudgets;
    maxTokens?: number;
  },
) {
  let payload: unknown;

  const currentTime = yield* Clock.currentTimeMillis;
  yield* Effect.promise(() =>
    streamSimple(
      model,
      { messages: [{ content: "Hi", role: "user", timestamp: currentTime }] },
      {
        apiKey: "test",
        maxTokens: options?.maxTokens,
        onPayload: (params: unknown) => {
          payload = params;
        },
        reasoning: options?.reasoning,
        thinkingBudgets: options?.thinkingBudgets,
      },
    ).result(),
  );

  return (payload ?? mockState.lastParams) as CapturedParams;
});

describe("openai-completions thinking token budget", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
  });
  it("sends the configured budget for the requested level", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const params = yield* capture(vllmModel(), {
          reasoning: "medium",
          thinkingBudgets: { medium: 4096 },
        });
        expect(params.thinking_token_budget).toBe(4096);
      }),
    ));

  it("omits the budget when neither the field nor the alias is set", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const params = yield* capture(vllmModel({ thinkingFormat: "qwen" }), {
          reasoning: "medium",
          thinkingBudgets: { medium: 4096 },
        });
        expect(params.thinking_token_budget).toBeUndefined();
        expect(params.thinking_budget).toBeUndefined();
        expect(params.thinking_budget_tokens).toBeUndefined();
      }),
    ));

  it("omits the budget when thinking is off", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const params = yield* capture(vllmModel(), {
          reasoning: undefined,
          thinkingBudgets: { high: 8192 },
        });
        expect(params.thinking_token_budget).toBeUndefined();
      }),
    ));
});

describe("openai-completions thinking token budget", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
  });
  it("clamps xhigh and max to the high budget", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const xhigh = yield* capture(vllmModel(), {
          reasoning: "xhigh",
          thinkingBudgets: { high: 8192 },
        });
        const max = yield* capture(vllmModel(), {
          reasoning: "max",
          thinkingBudgets: { high: 8192 },
        });
        expect(xhigh.thinking_token_budget).toBe(8192);
        expect(max.thinking_token_budget).toBe(8192);
      }),
    ));

  it("leaves room for the answer when the budget meets the response ceiling", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const params = yield* capture(vllmModel(), { reasoning: "high" });
        expect(params.thinking_token_budget).toBe(16384 - 1024);
      }),
    ));

  it("uses the caller max_tokens as the ceiling when it is lower than the model cap", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const params = yield* capture(vllmModel(), {
          maxTokens: 4096,
          reasoning: "high",
          thinkingBudgets: { high: 8192 },
        });
        expect(params.thinking_token_budget).toBe(4096 - 1024);
      }),
    ));
});

describe("openai-completions thinking token budget", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
  });
  it.each(["thinking_budget", "thinking_budget_tokens"] as const)(
    "sends %s when thinkingTokenBudgetField is set",
    (field) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const params = yield* capture(
            vllmModel({ thinkingFormat: "qwen", thinkingTokenBudgetField: field }),
            {
              reasoning: "medium",
              thinkingBudgets: { medium: 4096 },
            },
          );
          expect(params[field]).toBe(4096);
          expect(params.thinking_token_budget).toBeUndefined();
        }),
      ),
  );

  it("lets thinkingTokenBudgetField win over the boolean alias", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const params = yield* capture(
          vllmModel({
            supportsThinkingTokenBudget: true,
            thinkingFormat: "qwen",
            thinkingTokenBudgetField: "thinking_budget",
          }),
          { reasoning: "medium", thinkingBudgets: { medium: 4096 } },
        );
        expect(params.thinking_budget).toBe(4096);
        expect(params.thinking_token_budget).toBeUndefined();
      }),
    ));
});

describe("openai-completions thinking token budget", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
  });
  it("puts the clamped budget in chat_template_kwargs when $var is thinking.budget", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const params = yield* capture(
          vllmModel({
            chatTemplateKwargs: {
              enable_thinking: { $var: "thinking.enabled" },
              thinking_budget: { $var: "thinking.budget" },
            },
            thinkingFormat: "chat-template",
          }),
          { reasoning: "high" },
        );
        expect(params.chat_template_kwargs).toEqual({
          enable_thinking: true,
          thinking_budget: 16384 - 1024,
        });
        expect(params.thinking_token_budget).toBeUndefined();
      }),
    ));

  it("omits thinking.budget from chat_template_kwargs when thinking is off", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const params = yield* capture(
          vllmModel({
            chatTemplateKwargs: {
              enable_thinking: { $var: "thinking.enabled" },
              thinking_budget: { $var: "thinking.budget" },
            },
            thinkingFormat: "chat-template",
          }),
          { reasoning: undefined },
        );
        expect(params.chat_template_kwargs).toEqual({ enable_thinking: false });
      }),
    ));
});
