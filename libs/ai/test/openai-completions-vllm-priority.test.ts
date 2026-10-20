import { Clock, Effect, Stream } from "effect";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import openaiCompletions from "../src/api/openai-completions.ts";
import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import modelChoice from "./model-choice.ts";

const { stream: streamOpenAICompletions } = openaiCompletions;
const { normalizeContext } = compatModule;

const { chooseModel } = modelChoice;

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

function createModel(
  overrides: Partial<typesModule.Model<"openai-completions">> = {},
): typesModule.Model<"openai-completions"> {
  const { compat: _compat, ...baseModel } = chooseModel("openai", "direct OpenAI");
  return {
    ...(baseModel as Omit<typesModule.Model<"openai-completions">, "api">),
    api: "openai-completions",
    ...overrides,
  };
}

const captureRequest = Effect.fn("captureRequest")(function* (
  model: typesModule.Model<"openai-completions">,
) {
  const currentTime = yield* Clock.currentTimeMillis;
  yield* Effect.promise(() =>
    streamOpenAICompletions(
      model,
      normalizeContext({
        messages: [{ content: "hi", role: "user", timestamp: currentTime }],
        systemPrompt: "sys",
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
          createModel({
            compat: { vllmPriority: 10 } as typesModule.Model<"openai-completions">["compat"],
          }),
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
