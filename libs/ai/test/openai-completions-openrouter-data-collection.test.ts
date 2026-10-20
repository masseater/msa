import { Clock, Effect, Stream } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

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

const directModel = () => {
  const { compat: _compat, ...base } = chooseModel("openai", "direct OpenAI");
  return { ...base, api: "openai-completions" } as const;
};

const openRouterModel = (routing?: Record<string, unknown>) => ({
  ...directModel(),
  baseUrl: "https://openrouter.ai/api/v1",
  provider: "openrouter",
  ...(routing === undefined ? {} : { compat: { openRouterRouting: routing } }),
});

const sentParams = (model: ReturnType<typeof directModel>) =>
  Effect.gen(function* () {
    const timestamp = yield* Clock.currentTimeMillis;
    yield* Effect.promise(() =>
      streamSimple(
        model,
        { messages: [{ content: "hi", role: "user", timestamp }] },
        { apiKey: "test" },
      ).result(),
    );
    return mockState.lastParams as { provider?: unknown };
  });

const expectSentProvider =
  (routing: Record<string, unknown> | undefined, expected: Record<string, unknown>) => () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect((yield* sentParams(openRouterModel(routing))).provider).toEqual(expected);
      }),
    );

const omitsRoutingElsewhere = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      expect("provider" in (yield* sentParams(directModel()))).toBe(false);
    }),
  );

describe("openrouter data_collection default", () => {
  it(
    "denies data collection when nothing is configured",
    expectSentProvider(undefined, { data_collection: "deny" }),
  );
  it(
    "keeps deny next to other routing preferences",
    expectSentProvider(
      { only: ["deepinfra/fp8"] },
      { data_collection: "deny", only: ["deepinfra/fp8"] },
    ),
  );
  it(
    "sends allow only when the model sets it explicitly",
    expectSentProvider({ data_collection: "allow" }, { data_collection: "allow" }),
  );
  it("does not add provider routing to other endpoints", omitsRoutingElsewhere);
});
