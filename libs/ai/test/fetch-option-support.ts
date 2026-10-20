import { expect, vi } from "vite-plus/test";

import type { Api, FetchFunction, Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";
const context = normalizeContext({
  messages: [{ content: "hello", role: "user", timestamp: 1 }],
});

function createModel<TApi extends Api>(api: TApi): Model<TApi> {
  return {
    api,
    baseUrl: "https://upstream.test/v1",
    contextWindow: 10_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "test-model",
    input: ["text"],
    maxTokens: 1_000,
    name: "Test Model",
    provider: "test-provider",
    reasoning: false,
  };
}

function mockFetches() {
  const fallback = vi.fn<FetchFunction>(() =>
    Promise.reject(new Error("ambient fetch must not be called")),
  );
  const custom = vi.fn<FetchFunction>(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { message: "upstream rejected request" } }), {
        headers: { "content-type": "application/json" },
        status: 401,
      }),
    ),
  );
  vi.stubGlobal("fetch", fallback);
  return { custom, fallback };
}

function expectOnlyCustomFetch(
  custom: ReturnType<typeof vi.fn<FetchFunction>>,
  fallback: ReturnType<typeof vi.fn<FetchFunction>>,
) {
  expect(custom).toHaveBeenCalled();
  expect(fallback).not.toHaveBeenCalled();
  expect(globalThis.fetch).toBe(fallback);
}

const fetchOptionSupport = {
  context,
  createModel,
  expectOnlyCustomFetch,
  mockFetches,
};

export default fetchOptionSupport;
