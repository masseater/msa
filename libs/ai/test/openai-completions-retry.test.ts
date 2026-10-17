import { Effect, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import type { Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

const mockState = vi.hoisted(() => ({
  requestOptions: [] as unknown[],
  requestErrors: [] as Error[],
}));

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: (_params: unknown, options: unknown) => {
          mockState.requestOptions.push(options);
          const stream = {
            async *[Symbol.asyncIterator]() {
              yield {
                id: "chatcmpl-test",
                choices: [{ index: 0, delta: { content: "ok" } }],
              };
              yield {
                id: "chatcmpl-test",
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
              };
            },
          };
          const promise = Promise.resolve(stream) as Promise<typeof stream> & {
            withResponse: () => Promise<{
              data: typeof stream;
              response: { status: number; headers: Headers };
            }>;
          };
          promise.withResponse = () => {
            const error = mockState.requestErrors.shift();
            if (error !== undefined) return Promise.reject(error);
            return Promise.resolve({
              data: stream,
              response: { status: 200, headers: new Headers() },
            });
          };
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
  provider: "opencode-go",
  baseUrl: "https://opencode.ai/zen/go/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

const context = normalizeContext({
  systemPrompt: "",
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 }],
  tools: [],
});

function consume(options?: { maxRetries?: number; maxRetryDelayMs?: number }) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const stream = streamOpenAICompletions(model, context, { apiKey: "test", ...options });
      yield* Stream.fromAsyncIterable(stream, (error) => error).pipe(Stream.orDie, Stream.runDrain);
      return yield* Effect.promise(() => stream.result());
    }),
  );
}

describe("openai-completions provider retries", () => {
  beforeEach(() => {
    mockState.requestOptions = [];
    mockState.requestErrors = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("disables SDK retries by default", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.promise(() => consume());
        expect(mockState.requestOptions).toEqual([expect.objectContaining({ maxRetries: 0 })]);
      }),
    ));
});

describe("openai-completions provider retries", () => {
  beforeEach(() => {
    mockState.requestOptions = [];
    mockState.requestErrors = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("honors provider retries while keeping SDK retries disabled", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        vi.useFakeTimers();
        mockState.requestErrors = [
          Object.assign(new Error("rate limited"), {
            status: 429,
            headers: new Headers({ "retry-after-ms": "100" }),
          }),
          Object.assign(new Error("server error"), {
            status: 500,
            headers: new Headers({ "retry-after-ms": "100" }),
          }),
        ];

        const result = consume({ maxRetries: 2, maxRetryDelayMs: 100 });
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(0));
        expect(mockState.requestOptions).toHaveLength(1);
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(99));
        expect(mockState.requestOptions).toHaveLength(1);
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));
        expect(mockState.requestOptions).toHaveLength(2);
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(99));
        expect(mockState.requestOptions).toHaveLength(2);
        yield* Effect.promise(() => vi.advanceTimersByTimeAsync(1));
        yield* Effect.promise(() => result);

        expect(mockState.requestOptions).toEqual([
          expect.objectContaining({ maxRetries: 0 }),
          expect.objectContaining({ maxRetries: 0 }),
          expect.objectContaining({ maxRetries: 0 }),
        ]);
      }),
    ));
});

describe("openai-completions provider retries", () => {
  beforeEach(() => {
    mockState.requestOptions = [];
    mockState.requestErrors = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("fails immediately when a provider-requested retry delay exceeds the limit", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        mockState.requestErrors = [
          Object.assign(new Error("rate limited"), {
            status: 429,
            headers: new Headers({ "retry-after": "277403" }),
          }),
        ];

        const result = yield* Effect.promise(() =>
          consume({ maxRetries: 2, maxRetryDelayMs: 1000 }),
        );

        expect(result.stopReason).toBe("error");
        expect(result.errorMessage).toContain("Server requested 277403s retry delay (max: 1s)");
        expect(result.errorMessage).toContain("rate limited");
        expect(mockState.requestOptions).toEqual([expect.objectContaining({ maxRetries: 0 })]);
      }),
    ));
});
