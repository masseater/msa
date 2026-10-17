import { Clock, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getModel, streamSimple } from "../src/compat.ts";
import { currentTimeMillis } from "../src/utils/clock.ts";

const mockState = vi.hoisted(() => ({
  lastParams: undefined as unknown,
  lastClientOptions: undefined as unknown,
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
            async *[Symbol.asyncIterator]() {
              yield {
                choices: [{ delta: {}, finish_reason: "stop" }],
                usage: {
                  prompt_tokens: 1,
                  completion_tokens: 1,
                  prompt_tokens_details: { cached_tokens: 0 },
                  completion_tokens_details: { reasoning_tokens: 0 },
                },
              };
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

describe("openai-completions empty tools handling", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastClientOptions = undefined;
  });

  it("omits tools field when context.tools is an empty array", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
        const model = { ...baseModel, api: "openai-completions" } as const;

        const currentTime = yield* Clock.currentTimeMillis;
        yield* Effect.promise(() =>
          streamSimple(
            model,
            {
              messages: [{ role: "user", content: "hi", timestamp: currentTime }],
              tools: [],
            },
            { apiKey: "test" },
          ).result(),
        );

        const params = mockState.lastParams as { tools?: unknown };
        expect("tools" in (params as object)).toBe(false);
      }),
    ));

  it("omits tools field when context.tools is undefined", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
        const model = { ...baseModel, api: "openai-completions" } as const;

        const currentTime1 = yield* Clock.currentTimeMillis;
        yield* Effect.promise(() =>
          streamSimple(
            model,
            {
              messages: [{ role: "user", content: "hi", timestamp: currentTime1 }],
            },
            { apiKey: "test" },
          ).result(),
        );

        const params = mockState.lastParams as { tools?: unknown };
        expect("tools" in (params as object)).toBe(false);
      }),
    ));

  it("sends default maxTokens", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
        const model = { ...baseModel, api: "openai-completions" } as const;

        const currentTime2 = yield* Clock.currentTimeMillis;
        yield* Effect.promise(() =>
          streamSimple(
            model,
            {
              messages: [{ role: "user", content: "hi", timestamp: currentTime2 }],
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
    ));

  it("sends explicit maxTokens", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
        const model = { ...baseModel, api: "openai-completions" } as const;

        const currentTime3 = yield* Clock.currentTimeMillis;
        yield* Effect.promise(() =>
          streamSimple(
            model,
            {
              messages: [{ role: "user", content: "hi", timestamp: currentTime3 }],
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
    ));

  it("clamps default maxTokens to remaining context", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
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
              messages: [{ role: "user", content: "x".repeat(8000), timestamp: currentTime4 }],
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
    ));

  it("clamps explicit maxTokens to remaining context", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
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
              messages: [{ role: "user", content: "x".repeat(8000), timestamp: currentTime5 }],
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
    ));

  it("uses conservative OpenAI-compatible fields for Cloudflare AI Gateway /compat models", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("CLOUDFLARE_API_KEY", "cf-token");
        vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");
        vi.stubEnv("CLOUDFLARE_GATEWAY_ID", "gateway-id");
        const model = getModel("cloudflare-ai-gateway", "workers-ai/@cf/moonshotai/kimi-k2.6")!;

        const currentTime6 = yield* Clock.currentTimeMillis;
        yield* Effect.promise(() =>
          streamSimple(
            model,
            {
              systemPrompt: "You are helpful.",
              messages: [{ role: "user", content: "hi", timestamp: currentTime6 }],
            },
            { maxTokens: 1234, reasoning: "high" },
          ).result(),
        );

        const params = mockState.lastParams as {
          messages: Array<{ role: string }>;
          max_tokens?: number;
          max_completion_tokens?: number;
          reasoning_effort?: string;
          store?: boolean;
        };
        expect(params.messages[0]?.role).toBe("system");
        expect(params.max_tokens).toBe(1234);
        expect(params.max_completion_tokens).toBeUndefined();
        expect(params.reasoning_effort).toBeUndefined();
        expect(params.store).toBeUndefined();

        const clientOptions = mockState.lastClientOptions as {
          baseURL?: string;
          defaultHeaders?: Record<string, unknown>;
        };
        expect(clientOptions.baseURL).toBe(
          "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/compat",
        );
        expect(clientOptions.defaultHeaders?.["Authorization"]).toBeNull();
        expect(clientOptions.defaultHeaders?.["cf-aig-authorization"]).toBe("Bearer cf-token");
      }),
    ));

  it("resolves Cloudflare AI Gateway base URL through provider auth", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("CLOUDFLARE_API_KEY", "cf-token");
        vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");
        vi.stubEnv("CLOUDFLARE_GATEWAY_ID", "gateway-id");
        const model = getModel("cloudflare-ai-gateway", "workers-ai/@cf/moonshotai/kimi-k2.6")!;

        const currentTime7 = yield* Clock.currentTimeMillis;
        yield* Effect.promise(() =>
          streamSimple(model, {
            messages: [{ role: "user", content: "hi", timestamp: currentTime7 }],
          }).result(),
        );

        const clientOptions = mockState.lastClientOptions as { baseURL?: string };
        expect(clientOptions.baseURL).toBe(
          "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/compat",
        );
      }),
    ));

  it("preserves inline upstream Authorization for Cloudflare AI Gateway BYOK requests", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("CLOUDFLARE_API_KEY", "cf-token");
        vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");
        vi.stubEnv("CLOUDFLARE_GATEWAY_ID", "gateway-id");
        const model = getModel("cloudflare-ai-gateway", "gpt-5.1")!;

        const currentTime8 = yield* Clock.currentTimeMillis;
        yield* Effect.promise(() =>
          streamSimple(
            model,
            {
              messages: [{ role: "user", content: "hi", timestamp: currentTime8 }],
            },
            { headers: { Authorization: "Bearer upstream-token" } },
          ).result(),
        );

        const clientOptions = mockState.lastClientOptions as {
          defaultHeaders?: Record<string, unknown>;
        };
        expect(clientOptions.defaultHeaders?.["Authorization"]).toBe("Bearer upstream-token");
        expect(clientOptions.defaultHeaders?.["cf-aig-authorization"]).toBe("Bearer cf-token");
      }),
    ));

  it("sends session affinity headers for Workers AI through Cloudflare AI Gateway", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("CLOUDFLARE_API_KEY", "cf-token");
        vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "account-id");
        vi.stubEnv("CLOUDFLARE_GATEWAY_ID", "gateway-id");
        const workersModel = getModel(
          "cloudflare-ai-gateway",
          "workers-ai/@cf/moonshotai/kimi-k2.6",
        )!;

        const currentTime9 = yield* Clock.currentTimeMillis;
        yield* Effect.promise(() =>
          streamSimple(
            workersModel,
            {
              messages: [{ role: "user", content: "hi", timestamp: currentTime9 }],
            },
            { sessionId: "session-1" },
          ).result(),
        );

        const clientOptions = mockState.lastClientOptions as {
          defaultHeaders?: Record<string, string>;
        };
        expect(clientOptions.defaultHeaders?.["session_id"]).toBe("session-1");
        expect(clientOptions.defaultHeaders?.["x-client-request-id"]).toBe("session-1");
        expect(clientOptions.defaultHeaders?.["x-session-affinity"]).toBe("session-1");
      }),
    ));

  it("still emits tools: [] for Anthropic/LiteLLM proxy when conversation has tool history", async () => {
    const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini")!;
    const model = { ...baseModel, api: "openai-completions" } as const;

    await streamSimple(
      model,
      {
        messages: [
          { role: "user", content: "use the tool", timestamp: currentTimeMillis() },
          {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "t1",
                name: "noop",
                arguments: {},
              },
            ],
            stopReason: "toolUse",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            api: "openai-completions",
            provider: "openai",
            model: "gpt-4o-mini",
            timestamp: currentTimeMillis(),
          },
          {
            role: "toolResult",
            toolCallId: "t1",
            toolName: "noop",
            content: [{ type: "text", text: "done" }],
            isError: false,
            timestamp: currentTimeMillis(),
          },
        ],
        tools: [],
      },
      { apiKey: "test" },
    ).result();

    const params = mockState.lastParams as { tools?: unknown[] };
    expect(Array.isArray(params.tools)).toBe(true);
    expect(params.tools).toEqual([]);
  });
});
