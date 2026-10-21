import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import googleGenerativeAi from "../src/api/google-generative-ai.ts";
import openaiCodexResponses from "../src/api/openai-codex-responses.ts";
import fetchOptionSupport from "./fetch-option-support.ts";
import jsonCodec from "./json-codec.ts";

const { streamSimple: streamOpenAICodexResponses } = openaiCodexResponses;
const { streamSimple: streamGoogleGenerativeAI } = googleGenerativeAi;

const { context, createModel, mockFetches } = fetchOptionSupport;

afterEach(() => {
  vi.unstubAllGlobals();
});

const { encodeJson } = jsonCodec;

describe("fetch stream option", () => {
  it("uses fetch for Codex SSE requests", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { custom, fallback } = mockFetches();
        const encodedJson = yield* encodeJson({
          "https://api.openai.com/auth": { chatgpt_account_id: "account" },
        });
        yield* Effect.promise(() =>
          streamOpenAICodexResponses(createModel("openai-codex-responses"), context, {
            apiKey: `header.${btoa(encodedJson)}.signature`,
            fetch: custom,
            maxRetries: 0,
            transport: "sse",
          }).result(),
        );
        expect(custom).toHaveBeenCalledTimes(1);
        expect(fallback).not.toHaveBeenCalled();
        expect(globalThis.fetch).toBe(fallback);
      }),
    ));
});

describe("fetch stream option", () => {
  it("rejects custom fetch for the Google adapter instead of silently bypassing it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { custom, fallback } = mockFetches();
        const google = yield* Effect.promise(() =>
          streamGoogleGenerativeAI(createModel("google-generative-ai"), context, {
            apiKey: "test-key",
            fetch: custom,
          }).result(),
        );

        expect(google.errorMessage).toContain(
          "Custom fetch is not supported by the Google Generative AI adapter",
        );
        expect(custom).not.toHaveBeenCalled();
        expect(fallback).not.toHaveBeenCalled();
        expect(globalThis.fetch).toBe(fallback);
      }),
    ));
});
