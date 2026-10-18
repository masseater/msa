import { Clock, Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import type { Model } from "../src/types.ts";
import { envValue } from "./env.ts";

interface FakeOpenAIClientOptions {
  apiKey: string;
  baseURL: string;
  dangerouslyAllowBrowser: boolean;
  defaultHeaders?: Record<string, string>;
}

interface CapturedCompletionsPayload {
  prompt_cache_key?: string;
  prompt_cache_retention?: "24h" | "in-memory" | null;
  session_id?: string;
}

const mockState = vi.hoisted(() => ({
  lastParams: undefined as CapturedCompletionsPayload | undefined,
  lastClientOptions: undefined as FakeOpenAIClientOptions | undefined,
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: (params: CapturedCompletionsPayload) => {
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

    constructor(options: FakeOpenAIClientOptions) {
      mockState.lastClientOptions = options;
    }
  }

  return { default: FakeOpenAI };
});

describe("openai-completions prompt caching", () => {
  const originalEnv = envValue("MSA_CACHE_RETENTION");

  beforeEach(() => {
    mockState.lastParams = undefined;
    mockState.lastClientOptions = undefined;
    vi.stubEnv("MSA_CACHE_RETENTION", undefined);
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      vi.stubEnv("MSA_CACHE_RETENTION", undefined);
    } else {
      vi.stubEnv("MSA_CACHE_RETENTION", originalEnv);
    }
  });

  function createModel(
    overrides: Partial<Model<"openai-completions">> = {},
  ): Model<"openai-completions"> {
    const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini");
    return {
      ...(baseModel as Omit<Model<"openai-completions">, "api">),
      api: "openai-completions",
      ...overrides,
    };
  }

  const captureRequest = Effect.fn("captureRequest")(function* (
    options?: {
      cacheRetention?: "none" | "short" | "long";
      sessionId?: string;
      headers?: Record<string, string>;
    },
    model: Model<"openai-completions"> = createModel(),
  ) {
    const currentTime = yield* Clock.currentTimeMillis;
    yield* Effect.promise(() =>
      streamOpenAICompletions(
        model,
        normalizeContext({
          systemPrompt: "sys",
          messages: [{ role: "user", content: "hi", timestamp: currentTime }],
        }),
        { apiKey: "test-key", ...options },
      ).result(),
    );

    return {
      payload: mockState.lastParams,
      headers: mockState.lastClientOptions?.defaultHeaders ?? {},
    };
  });

  it("sets prompt_cache_key for direct OpenAI requests when caching is enabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { payload } = yield* captureRequest({ sessionId: "session-123" });

        expect(payload?.prompt_cache_key).toBe("session-123");
        expect(payload?.prompt_cache_retention).toBeUndefined();
      }),
    ));

  it("sets prompt_cache_retention to 24h for direct OpenAI requests when cacheRetention is long", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { payload } = yield* captureRequest({
          cacheRetention: "long",
          sessionId: "session-456",
        });

        expect(payload?.prompt_cache_key).toBe("session-456");
        expect(payload?.prompt_cache_retention).toBe("24h");
      }),
    ));

  it("clamps prompt_cache_key to OpenAI's 64-character limit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const sessionId = "x".repeat(67);
        const { payload } = yield* captureRequest({ sessionId });

        expect(payload?.prompt_cache_key).toBe("x".repeat(64));
      }),
    ));

  it("omits prompt cache fields when cacheRetention is none", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { payload } = yield* captureRequest({
          cacheRetention: "none",
          sessionId: "session-789",
        });

        expect(payload?.prompt_cache_key).toBeUndefined();
        expect(payload?.prompt_cache_retention).toBeUndefined();
      }),
    ));

  it("omits prompt cache fields for non-OpenAI base URLs without compatible long retention", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = createModel({
          baseUrl: "https://proxy.example.com/v1",
          compat: { supportsLongCacheRetention: false },
        });
        const { payload } = yield* captureRequest(
          { cacheRetention: "long", sessionId: "session-proxy" },
          model,
        );

        expect(payload?.prompt_cache_key).toBeUndefined();
        expect(payload?.prompt_cache_retention).toBeUndefined();
      }),
    ));

  it("uses MSA_CACHE_RETENTION for direct OpenAI requests", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.stubEnv("MSA_CACHE_RETENTION", "long");
        const { payload } = yield* captureRequest({ sessionId: "session-env" });

        expect(payload?.prompt_cache_key).toBe("session-env");
        expect(payload?.prompt_cache_retention).toBe("24h");
      }),
    ));

  it("sends known session-affinity headers when compat.sendSessionAffinityHeaders is enabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = createModel({
          baseUrl: "https://proxy.example.com/v1",
          compat: { sendSessionAffinityHeaders: true },
        });
        const { headers } = yield* captureRequest({ sessionId: "session-affinity" }, model);

        expect(headers["session_id"]).toBe("session-affinity");
        expect(headers["x-client-request-id"]).toBe("session-affinity");
        expect(headers["x-session-affinity"]).toBe("session-affinity");
      }),
    ));

  it("uses OpenAI no-session format when configured", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = createModel({
          compat: { sendSessionAffinityHeaders: true, sessionAffinityFormat: "openai-nosession" },
        });
        const { payload, headers } = yield* captureRequest(
          { sessionId: "session-nosession" },
          model,
        );

        expect(payload?.session_id).toBeUndefined();
        expect(payload?.prompt_cache_key).toBe("session-nosession");
        expect(headers["session_id"]).toBeUndefined();
        expect(headers["x-client-request-id"]).toBe("session-nosession");
        expect(headers["x-session-affinity"]).toBe("session-nosession");
        expect(headers["x-session-id"]).toBeUndefined();
      }),
    ));

  it("uses OpenRouter session-affinity header when configured", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = createModel({
          baseUrl: "https://proxy.example.com/v1",
          compat: { sendSessionAffinityHeaders: true, sessionAffinityFormat: "openrouter" },
        });
        const { payload, headers } = yield* captureRequest({ sessionId: "session-proxy" }, model);

        expect(payload?.session_id).toBeUndefined();
        expect(payload?.prompt_cache_key).toBeUndefined();
        expect(headers["x-session-id"]).toBe("session-proxy");
        expect(headers["session_id"]).toBeUndefined();
        expect(headers["x-client-request-id"]).toBeUndefined();
        expect(headers["x-session-affinity"]).toBeUndefined();
      }),
    ));

  it("sends OpenRouter session-affinity header by default for built-in OpenRouter models", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("openrouter", "auto");
        const { payload, headers } = yield* captureRequest(
          { sessionId: "session-openrouter" },
          model,
        );

        expect(payload?.session_id).toBeUndefined();
        expect(payload?.prompt_cache_key).toBeUndefined();
        expect(headers["x-session-id"]).toBe("session-openrouter");
        expect(headers["session_id"]).toBeUndefined();
        expect(headers["x-client-request-id"]).toBeUndefined();
        expect(headers["x-session-affinity"]).toBeUndefined();
      }),
    ));

  it("omits OpenRouter session-affinity data when disabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = createModel({
          provider: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          compat: { sendSessionAffinityHeaders: false },
        });
        const { payload, headers } = yield* captureRequest(
          { sessionId: "session-openrouter" },
          model,
        );

        expect(payload?.session_id).toBeUndefined();
        expect(payload?.prompt_cache_key).toBeUndefined();
        expect(headers["x-session-id"]).toBeUndefined();
      }),
    ));

  it("omits session-affinity headers when cacheRetention is none", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = createModel({
          baseUrl: "https://proxy.example.com/v1",
          compat: { sendSessionAffinityHeaders: true },
        });
        const { headers } = yield* captureRequest(
          { cacheRetention: "none", sessionId: "session-affinity" },
          model,
        );

        expect(headers["session_id"]).toBeUndefined();
        expect(headers["x-client-request-id"]).toBeUndefined();
        expect(headers["x-session-affinity"]).toBeUndefined();
      }),
    ));

  it("lets explicit headers override generated session-affinity headers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = createModel({
          baseUrl: "https://proxy.example.com/v1",
          compat: { sendSessionAffinityHeaders: true },
        });
        const { headers } = yield* captureRequest(
          {
            sessionId: "session-affinity",
            headers: {
              session_id: "override-session",
              "x-client-request-id": "override-request",
              "x-session-affinity": "override-affinity",
            },
          },
          model,
        );

        expect(headers["session_id"]).toBe("override-session");
        expect(headers["x-client-request-id"]).toBe("override-request");
        expect(headers["x-session-affinity"]).toBe("override-affinity");
      }),
    ));
});
