import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiCompletionsPromptCacheSupport from "./openai-completions-prompt-cache-support.ts";

vi.mock("openai", () =>
  import("./openai-completions-prompt-cache-mock.ts").then((module) => module.default),
);

const { captureRequest, createModel, isolateCacheRetentionEnv } =
  openaiCompletionsPromptCacheSupport;

const setsPromptCacheKeyForDirect = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* captureRequest({ sessionId: "session-123" });
      expect(payload?.prompt_cache_key).toBe("session-123");
      expect(payload?.prompt_cache_retention).toBeUndefined();
    }),
  );

const setsPromptCacheRetentionTo24h = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* captureRequest({
        cacheRetention: "long",
        sessionId: "session-456",
      });
      expect(payload?.prompt_cache_key).toBe("session-456");
      expect(payload?.prompt_cache_retention).toBe("24h");
    }),
  );

const clampsPromptCacheKeyToOpenAI = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* captureRequest({ sessionId: "x".repeat(67) });
      expect(payload?.prompt_cache_key).toBe("x".repeat(64));
    }),
  );

const omitsPromptCacheFieldsWhenCacheRetention = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { payload } = yield* captureRequest({
        cacheRetention: "none",
        sessionId: "session-789",
      });
      expect(payload?.prompt_cache_key).toBeUndefined();
      expect(payload?.prompt_cache_retention).toBeUndefined();
    }),
  );

const omitsPromptCacheFieldsForNon = () =>
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
  );

const usesMSACACHERETENTIONForDirect = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      vi.stubEnv("MSA_CACHE_RETENTION", "long");
      const { payload } = yield* captureRequest({ sessionId: "session-env" });
      expect(payload?.prompt_cache_key).toBe("session-env");
      expect(payload?.prompt_cache_retention).toBe("24h");
    }),
  );

describe("openai-completions prompt caching", () => {
  isolateCacheRetentionEnv();

  it(
    "sets prompt_cache_key for direct OpenAI requests when caching is enabled",
    setsPromptCacheKeyForDirect,
  );

  it(
    "sets prompt_cache_retention to 24h for direct OpenAI requests when cacheRetention is long",
    setsPromptCacheRetentionTo24h,
  );

  it("clamps prompt_cache_key to OpenAI's 64-character limit", clampsPromptCacheKeyToOpenAI);

  it(
    "omits prompt cache fields when cacheRetention is none",
    omitsPromptCacheFieldsWhenCacheRetention,
  );

  it(
    "omits prompt cache fields for non-OpenAI base URLs without compatible long retention",
    omitsPromptCacheFieldsForNon,
  );

  it("uses MSA_CACHE_RETENTION for direct OpenAI requests", usesMSACACHERETENTIONForDirect);
});
