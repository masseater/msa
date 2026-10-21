import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import anthropicMessages from "../src/api/anthropic-messages.ts";
import openaiCompletions from "../src/api/openai-completions.ts";
import openaiResponses from "../src/api/openai-responses.ts";
import fetchOptionSupport from "./fetch-option-support.ts";

const { streamSimple: streamAnthropic } = anthropicMessages;
const { streamSimple: streamOpenAICompletions } = openaiCompletions;
const { streamSimple: streamOpenAIResponses } = openaiResponses;

const { context, createModel, expectOnlyCustomFetch, mockFetches } = fetchOptionSupport;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetch stream option", () => {
  it("passes fetch through streamSimple to the Anthropic SDK", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { custom, fallback } = mockFetches();
        yield* Effect.promise(() =>
          streamAnthropic(createModel("anthropic-messages"), context, {
            apiKey: "test-key",
            fetch: custom,
            maxRetries: 0,
          }).result(),
        );
        expectOnlyCustomFetch(custom, fallback);
      }),
    ));

  it("passes fetch through streamSimple to OpenAI SDK adapters", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const adapters = [
          () =>
            streamOpenAICompletions(createModel("openai-completions"), context, {
              apiKey: "test-key",
              fetch: custom,
              maxRetries: 0,
            }).result(),
          () =>
            streamOpenAIResponses(createModel("openai-responses"), context, {
              apiKey: "test-key",
              fetch: custom,
              maxRetries: 0,
            }).result(),
        ];
        const { custom, fallback } = mockFetches();
        for (const run of adapters) {
          yield* Effect.promise(() => run());
        }
        expect(custom).toHaveBeenCalledTimes(adapters.length);
        expect(fallback).not.toHaveBeenCalled();
        expect(globalThis.fetch).toBe(fallback);
      }),
    ));
});
