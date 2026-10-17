import { Clock, Effect, Stream } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { stream as streamOpenAIResponses } from "../src/api/openai-responses.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import type { Model } from "../src/types.ts";
import { encodeJson } from "./json-codec.ts";

type CapturedHeaders =
  | Headers
  | string[][]
  | Record<string, string | readonly string[]>
  | undefined;

interface CapturedResponsesPayload {
  prompt_cache_key?: string;
  session_id?: string;
  tools?: Array<{ name?: string; strict?: boolean }>;
}

function getHeader(headers: CapturedHeaders, name: string): string | null {
  if (headers === undefined) return null;
  if (headers instanceof Headers) return headers.get(name);

  const lowerName = name.toLowerCase();
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key?.toLowerCase() === lowerName);
    return match?.[1] ?? null;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName)
      return typeof value === "string" ? value : value.join(", ");
  }
  return null;
}

function captureOpenAIResponseHeaders(
  options: Parameters<typeof streamOpenAIResponses>[2],
  model: Model<"openai-responses"> = getModel("openai", "gpt-5.4"),
): Promise<{
  sessionId: string | null;
  clientRequestId: string | null;
  xSessionId: string | null;
}> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const captured = {
        sessionId: null as string | null,
        clientRequestId: null as string | null,
        xSessionId: null as string | null,
      };
      vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
        captured.sessionId = getHeader(init?.headers, "session_id");
        captured.clientRequestId = getHeader(init?.headers, "x-client-request-id");
        captured.xSessionId = getHeader(init?.headers, "x-session-id");
        return Promise.resolve(
          new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      });

      const stream = streamOpenAIResponses(
        model,
        normalizeContext({
          systemPrompt: "sys",
          messages: [{ role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis }],
        }),
        { apiKey: "sk-test-key", ...options },
      );

      yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
        Stream.orDie,
        Stream.runForEachWhile((event) =>
          Effect.sync(() => {
            if (event.type === "done" || event.type === "error") return false;
            return true;
          }),
        ),
      );

      return captured;
    }),
  );
}

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("omits reasoning when no reasoning is requested", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("openai", "gpt-5-mini");
        let capturedPayload: unknown;

        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );

        const stream = streamOpenAIResponses(
          model,
          normalizeContext({
            systemPrompt: "sys",
            messages: [{ role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis }],
          }),
          {
            apiKey: "sk-test-key",
            onPayload: (payload) => {
              capturedPayload = payload;
            },
          },
        );

        yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
          Stream.orDie,
          Stream.runForEachWhile((event) =>
            Effect.sync(() => {
              if (event.type === "done" || event.type === "error") return false;
              return true;
            }),
          ),
        );

        expect(capturedPayload).not.toBeNull();
        expect(capturedPayload).not.toMatchObject({
          reasoning: expect.anything(),
        });
      }),
    ));
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("forwards required tool choice", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let capturedPayload: unknown;

        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );

        const stream = streamOpenAIResponses(
          getModel("openai", "gpt-5.4"),
          normalizeContext({
            messages: [
              {
                role: "user",
                content: "Do not call ping. Respond with text instead.",
                timestamp: yield* Clock.currentTimeMillis,
              },
            ],
            tools: [
              {
                name: "ping",
                description: "Ping",
                parameters: Type.Object({ value: Type.String() }),
              },
            ],
          }),
          {
            apiKey: "sk-test-key",
            toolChoice: "required",
            onPayload: (payload) => {
              capturedPayload = payload;
            },
          },
        );

        yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
          Stream.orDie,
          Stream.runForEachWhile((event) =>
            Effect.sync(() => {
              if (event.type === "done" || event.type === "error") return false;
              return true;
            }),
          ),
        );

        expect(capturedPayload).toMatchObject({
          tool_choice: "required",
          tools: [expect.objectContaining({ name: "ping" })],
        });
      }),
    ));
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("sets strict mode explicitly for Cloudflare OpenAI Responses tools", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("cloudflare-ai-gateway", "gpt-5.6-sol");
        let capturedPayload: CapturedResponsesPayload | undefined;

        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );

        const stream = streamOpenAIResponses(
          model,
          normalizeContext({
            messages: [
              { role: "user", content: "Use a tool.", timestamp: yield* Clock.currentTimeMillis },
            ],
            tools: [
              {
                name: "ordinary",
                description: "An ordinary tool",
                parameters: Type.Object({
                  path: Type.String(),
                  offset: Type.Optional(Type.Number()),
                }),
              },
              {
                name: "constrained",
                description: "A constrained tool",
                parameters: Type.Object({ value: Type.String() }),
                constrainedSampling: { type: "json_schema", strict: "prefer" },
              },
            ],
          }),
          {
            apiKey: "sk-test-key",
            onPayload: (payload) => {
              capturedPayload = payload as CapturedResponsesPayload;
            },
          },
        );

        yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
          Stream.orDie,
          Stream.runForEachWhile((event) =>
            Effect.sync(() => {
              if (event.type === "done" || event.type === "error") return false;
              return true;
            }),
          ),
        );

        expect(model.compat?.supportsStrictMode).toBe(true);
        expect(capturedPayload?.tools).toEqual([
          expect.objectContaining({ name: "ordinary", strict: false }),
          expect.objectContaining({ name: "constrained", strict: true }),
        ]);
      }),
    ));
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it.each([
    "gpt-5.1",
    "gpt-5.2",
    "gpt-5.3-codex",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.5",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-6-sol",
    "gpt-6-luna",
  ] as const)(
    "sends none reasoning effort for OpenAI %s when no reasoning is requested",
    (modelId) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const model = getModel("openai", modelId);
          let capturedPayload: unknown;

          vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("data: [DONE]\n\n", {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            }),
          );

          const stream = streamOpenAIResponses(
            model,
            normalizeContext({
              systemPrompt: "sys",
              messages: [
                { role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis },
              ],
            }),
            {
              apiKey: "sk-test-key",
              onPayload: (payload) => {
                capturedPayload = payload;
              },
            },
          );

          yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
            Stream.orDie,
            Stream.runForEachWhile((event) =>
              Effect.sync(() => {
                if (event.type === "done" || event.type === "error") return false;
                return true;
              }),
            ),
          );

          expect(capturedPayload).toMatchObject({
            reasoning: { effort: "none" },
          });
        }),
      ),
  );
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it.each([
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5-pro",
    "gpt-5.2-pro",
    "gpt-5.4-pro",
    "gpt-5.5-pro",
  ] as const)("omits reasoning effort for OpenAI %s when off is unsupported", (modelId) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("openai", modelId);
        let capturedPayload: unknown;

        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );

        const stream = streamOpenAIResponses(
          model,
          normalizeContext({
            systemPrompt: "sys",
            messages: [{ role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis }],
          }),
          {
            apiKey: "sk-test-key",
            onPayload: (payload) => {
              capturedPayload = payload;
            },
          },
        );

        yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
          Stream.orDie,
          Stream.runForEachWhile((event) =>
            Effect.sync(() => {
              if (event.type === "done" || event.type === "error") return false;
              return true;
            }),
          ),
        );

        expect(capturedPayload).not.toMatchObject({
          reasoning: expect.anything(),
        });
      }),
    ),
  );
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("sets cache-affinity headers for official OpenAI Responses requests with a sessionId", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const captured = yield* Effect.promise(() =>
          captureOpenAIResponseHeaders({ sessionId: "session-123" }),
        );

        expect(captured.sessionId).toBe("session-123");
        expect(captured.clientRequestId).toBe("session-123");
      }),
    ));
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("clamps prompt_cache_key to OpenAI's 64-character limit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const sessionId = "x".repeat(67);
        let capturedPayload: Pick<CapturedResponsesPayload, "prompt_cache_key"> | undefined;
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );

        const stream = streamOpenAIResponses(
          getModel("openai", "gpt-5.4"),
          normalizeContext({
            systemPrompt: "sys",
            messages: [{ role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis }],
          }),
          {
            apiKey: "sk-test-key",
            sessionId,
            onPayload: (payload) => {
              capturedPayload = payload as Pick<CapturedResponsesPayload, "prompt_cache_key">;
            },
          },
        );

        yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
          Stream.orDie,
          Stream.runForEachWhile((event) =>
            Effect.sync(() => {
              if (event.type === "done" || event.type === "error") return false;
              return true;
            }),
          ),
        );

        expect(capturedPayload?.prompt_cache_key).toBe("x".repeat(64));
      }),
    ));
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("sets cache-affinity headers for proxy OpenAI Responses requests with a sessionId", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const proxyModel: Model<"openai-responses"> = {
          ...getModel("openai", "gpt-5.4"),
          provider: "opencode",
          baseUrl: "https://proxy.example.com/v1",
        };
        const captured = yield* Effect.promise(() =>
          captureOpenAIResponseHeaders({ sessionId: "session-123" }, proxyModel),
        );

        expect(captured.sessionId).toBe("session-123");
        expect(captured.clientRequestId).toBe("session-123");
      }),
    ));

  it("uses OpenRouter session-affinity header when configured", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const proxyModel: Model<"openai-responses"> = {
          ...getModel("openai", "gpt-5.4"),
          provider: "proxy",
          baseUrl: "https://proxy.example.com/v1",
          compat: { sessionAffinityFormat: "openrouter" },
        };
        let capturedPayload: CapturedResponsesPayload | undefined;
        const captured = yield* Effect.promise(() =>
          captureOpenAIResponseHeaders(
            {
              sessionId: "session-proxy",
              onPayload: (payload) => {
                capturedPayload = payload as CapturedResponsesPayload;
              },
            },
            proxyModel,
          ),
        );

        expect(captured.sessionId).toBeNull();
        expect(captured.clientRequestId).toBeNull();
        expect(captured.xSessionId).toBe("session-proxy");
        expect(capturedPayload?.session_id).toBeUndefined();
        expect(capturedPayload?.prompt_cache_key).toBe("session-proxy");
      }),
    ));
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("auto-detects OpenRouter session-affinity header for OpenRouter Responses endpoints", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const openRouterModel: Model<"openai-responses"> = {
          ...getModel("openai", "gpt-5.4"),
          provider: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
        };
        let capturedPayload: CapturedResponsesPayload | undefined;
        const captured = yield* Effect.promise(() =>
          captureOpenAIResponseHeaders(
            {
              sessionId: "session-openrouter",
              onPayload: (payload) => {
                capturedPayload = payload as CapturedResponsesPayload;
              },
            },
            openRouterModel,
          ),
        );

        expect(captured.sessionId).toBeNull();
        expect(captured.clientRequestId).toBeNull();
        expect(captured.xSessionId).toBe("session-openrouter");
        expect(capturedPayload?.session_id).toBeUndefined();
        expect(capturedPayload?.prompt_cache_key).toBe("session-openrouter");
      }),
    ));
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("uses OpenAI no-session format when configured", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const proxyModel: Model<"openai-responses"> = {
          ...getModel("openai", "gpt-5.4"),
          provider: "proxy",
          baseUrl: "https://proxy.example.com/v1",
          compat: { sessionAffinityFormat: "openai-nosession" },
        };
        let capturedPayload: CapturedResponsesPayload | undefined;
        const captured = yield* Effect.promise(() =>
          captureOpenAIResponseHeaders(
            {
              sessionId: "session-proxy",
              onPayload: (payload) => {
                capturedPayload = payload as CapturedResponsesPayload;
              },
            },
            proxyModel,
          ),
        );

        expect(captured.sessionId).toBeNull();
        expect(captured.clientRequestId).toBe("session-proxy");
        expect(captured.xSessionId).toBeNull();
        expect(capturedPayload?.session_id).toBeUndefined();
        expect(capturedPayload?.prompt_cache_key).toBe("session-proxy");
      }),
    ));
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("uses OpenAI no-session format for OpenCode Responses models", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = getModel("opencode", "gpt-5.4");
        let capturedPayload: CapturedResponsesPayload | undefined;
        const captured = yield* Effect.promise(() =>
          captureOpenAIResponseHeaders(
            {
              sessionId: "session-opencode",
              onPayload: (payload) => {
                capturedPayload = payload as CapturedResponsesPayload;
              },
            },
            model,
          ),
        );

        expect(model.compat?.sessionAffinityFormat).toBe("openai-nosession");
        expect(captured.sessionId).toBeNull();
        expect(captured.clientRequestId).toBe("session-opencode");
        expect(captured.xSessionId).toBeNull();
        expect(capturedPayload?.prompt_cache_key).toBe("session-opencode");
      }),
    ));
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("can omit OpenAI session_id header while preserving other affinity data", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const proxyModel: Model<"openai-responses"> = {
          ...getModel("openai", "gpt-5.4"),
          provider: "opencode",
          baseUrl: "https://proxy.example.com/v1",
          compat: { sessionAffinityFormat: "openai-nosession" },
        };
        let capturedPayload: CapturedResponsesPayload | undefined;
        const captured = yield* Effect.promise(() =>
          captureOpenAIResponseHeaders(
            {
              sessionId: "session-123",
              onPayload: (payload) => {
                capturedPayload = payload as CapturedResponsesPayload;
              },
            },
            proxyModel,
          ),
        );

        expect(captured.sessionId).toBeNull();
        expect(captured.clientRequestId).toBe("session-123");
        expect(capturedPayload?.prompt_cache_key).toBe("session-123");
      }),
    ));

  it("lets explicit headers override the default OpenAI cache-affinity headers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const captured = yield* Effect.promise(() =>
          captureOpenAIResponseHeaders({
            sessionId: "session-123",
            headers: {
              session_id: "override-session",
              "x-client-request-id": "override-request",
            },
          }),
        );

        expect(captured.sessionId).toBe("override-session");
        expect(captured.clientRequestId).toBe("override-request");
      }),
    ));
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("omits OpenAI cache-affinity headers when cacheRetention is none", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const captured = yield* Effect.promise(() =>
          captureOpenAIResponseHeaders({
            cacheRetention: "none",
            sessionId: "session-123",
          }),
        );

        expect(captured.sessionId).toBeNull();
        expect(captured.clientRequestId).toBeNull();
      }),
    ));
});

describe("openai-responses provider defaults", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it.each([
    ["gpt-5.4", "priority", "priority", 2],
    ["gpt-5.5", "priority", "priority", 2.5],
    ["gpt-5.5", "flex", "flex", 0.5],
    ["gpt-6-luna", "priority", "fast", 2],
    ["gpt-6-luna", "fast", "fast", 2],
  ] as const)(
    "applies %s cost multiplier for requested %s and returned %s service tier",
    (modelId, serviceTier, responseServiceTier, multiplier) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const model = getModel("openai", modelId);
          const tokenCount = 100_000;
          const tokenScale = tokenCount / 1_000_000;
          const sse = `${[
            `data: ${yield* encodeJson({
              type: "response.completed",
              response: {
                status: "completed",
                service_tier: responseServiceTier,
                usage: {
                  input_tokens: tokenCount,
                  output_tokens: tokenCount,
                  total_tokens: tokenCount * 2,
                  input_tokens_details: { cached_tokens: 0 },
                },
              },
            })}`,
          ].join("\n\n")}\n\n`;

          vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(sse, {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            }),
          );

          const stream = streamOpenAIResponses(
            model,
            normalizeContext({
              systemPrompt: "sys",
              messages: [
                { role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis },
              ],
            }),
            { apiKey: "sk-test-key", serviceTier },
          );

          const result = yield* Effect.promise(() => stream.result());

          expect(result.usage.cost.input).toBeCloseTo(
            model.cost.input * multiplier * tokenScale,
            12,
          );
          expect(result.usage.cost.output).toBeCloseTo(
            model.cost.output * multiplier * tokenScale,
            12,
          );
          expect(result.usage.cost.total).toBeCloseTo(
            (model.cost.input + model.cost.output) * multiplier * tokenScale,
            12,
          );
        }),
      ),
  );
});

describe("openai-responses max_output_tokens compat", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("sends max_output_tokens by default", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let capturedPayload: { max_output_tokens?: number } | undefined;

        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );

        const stream = streamOpenAIResponses(
          getModel("openai", "gpt-5.4"),
          normalizeContext({
            systemPrompt: "sys",
            messages: [{ role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis }],
          }),
          {
            apiKey: "sk-test-key",
            maxTokens: 1024,
            onPayload: (payload) => {
              capturedPayload = payload as { max_output_tokens?: number };
            },
          },
        );

        yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
          Stream.orDie,
          Stream.runForEachWhile((event) =>
            Effect.sync(() => {
              if (event.type === "done" || event.type === "error") return false;
              return true;
            }),
          ),
        );

        expect(capturedPayload?.max_output_tokens).toBe(1024);
      }),
    ));
});

describe("openai-responses max_output_tokens compat", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("omits max_output_tokens when supportsMaxOutputTokens is false", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const baseModel = getModel("openai", "gpt-5.4");
        const model: Model<"openai-responses"> = {
          ...baseModel,
          compat: { ...baseModel.compat, supportsMaxOutputTokens: false },
        };
        let capturedPayload: { max_output_tokens?: number } | undefined;

        vi.spyOn(globalThis, "fetch").mockResolvedValue(
          new Response("data: [DONE]\n\n", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );

        const stream = streamOpenAIResponses(
          model,
          normalizeContext({
            systemPrompt: "sys",
            messages: [{ role: "user", content: "hi", timestamp: yield* Clock.currentTimeMillis }],
          }),
          {
            apiKey: "sk-test-key",
            maxTokens: 1024,
            onPayload: (payload) => {
              capturedPayload = payload as { max_output_tokens?: number };
            },
          },
        );

        yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(
          Stream.orDie,
          Stream.runForEachWhile((event) =>
            Effect.sync(() => {
              if (event.type === "done" || event.type === "error") return false;
              return true;
            }),
          ),
        );

        expect(capturedPayload?.max_output_tokens).toBeUndefined();
      }),
    ));
});
