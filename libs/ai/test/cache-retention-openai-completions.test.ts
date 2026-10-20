import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { stream as streamOpenAICompletions } from "../src/api/openai-completions.ts";
import type { Model } from "../src/types.ts";
import cacheRetentionSupport from "./cache-retention-support.ts";
import type cacheRetentionSupportTypes from "./cache-retention-support.types.ts";
import modelChoice from "./model-choice.ts";

const { capturePayload, context, createCompletionsModel, isolateCacheRetentionEnv } =
  cacheRetentionSupport;
const { modelsWhere } = modelChoice;

type CompletionsPayload = cacheRetentionSupportTypes.OpenAICompletionsCachePayload;

const captureLong = (model: Model<"openai-completions">, sessionId: string) =>
  capturePayload<CompletionsPayload>((onPayload) =>
    streamOpenAICompletions(model, context, {
      apiKey: "fake-key",
      cacheRetention: "long",
      onPayload,
      sessionId,
    }),
  );

const withoutLongRetention = modelsWhere(
  "opencode",
  (model) =>
    model.api === "openai-completions" && model.compat?.supportsLongCacheRetention === false,
);

const setsRetentionBehindProxy = Effect.map(
  captureLong(createCompletionsModel(), "session-completions"),
  (payload) => {
    expect(payload?.prompt_cache_key).toBe("session-completions");
    expect(payload?.prompt_cache_retention).toBe("24h");
  },
);

const omitsRetentionWithoutLongSupport = Effect.map(
  captureLong(
    createCompletionsModel({ supportsLongCacheRetention: false }),
    "session-completions-false",
  ),
  (payload) => {
    expect(payload).toBeDefined();
    expect(payload?.prompt_cache_key).toBeUndefined();
    expect(payload?.prompt_cache_retention).toBeUndefined();
  },
);

const omitsLongRetentionFor = (model: Model<"openai-completions">) =>
  Effect.map(captureLong(model, "session-opencode-long-cache-unsupported"), (payload) => {
    expect(payload).toBeDefined();
    expect(payload?.prompt_cache_key).toBeUndefined();
    expect(payload?.prompt_cache_retention).toBeUndefined();
  });

describe("Cache Retention (MSA_CACHE_RETENTION)", () => {
  isolateCacheRetentionEnv();

  describe("OpenAI Completions Provider", () => {
    it("should set prompt_cache_retention for non-api.openai.com baseUrl by default", () =>
      Effect.runPromise(setsRetentionBehindProxy));
    it("should omit prompt_cache_retention when supportsLongCacheRetention is false", () =>
      Effect.runPromise(omitsRetentionWithoutLongSupport));
    it("finds opencode models without long cache retention in the catalog", () => {
      expect(withoutLongRetention.length).toBeGreaterThan(0);
    });
    it.each(withoutLongRetention)("should omit long cache retention for $provider/$id", (model) =>
      Effect.runPromise(omitsLongRetentionFor(model as Model<"openai-completions">)),
    );
  });
});
