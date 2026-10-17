import { Clock, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import type { Model } from "../src/types.ts";

interface CapturedCompletionsPayload {
  priority?: number;
  [key: string]: unknown;
}

const mockState = vi.hoisted(() => ({
  lastParams: undefined as CapturedCompletionsPayload | undefined,
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
  }

  return { default: FakeOpenAI };
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

const captureRequest = Effect.fn("captureRequest")(function* (model: Model<"openai-completions">) {
  const currentTime = yield* Clock.currentTimeMillis;
  yield* Effect.promise(() =>
    streamOpenAICompletions(
      model,
      normalizeContext({
        systemPrompt: "sys",
        messages: [{ role: "user", content: "hi", timestamp: currentTime }],
      }),
      { apiKey: "test-key" },
    ).result(),
  );

  return mockState.lastParams;
});

describe("openai-completions vllm priority", () => {
  beforeEach(() => {
    mockState.lastParams = undefined;
  });

  it("sends compat.vllmPriority as the top-level priority request field", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* captureRequest(
          createModel({ compat: { vllmPriority: 10 } as Model<"openai-completions">["compat"] }),
        );

        expect(payload?.priority).toBe(10);
      }),
    ));

  it("omits priority when vllmPriority is not set", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* captureRequest(createModel());

        expect(payload?.priority).toBeUndefined();
      }),
    ));
});
