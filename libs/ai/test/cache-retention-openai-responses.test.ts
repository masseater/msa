import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import openaiResponses from "../src/api/openai-responses.ts";
import compatModule from "../src/compat.ts";
import type typesModule from "../src/types.types.ts";
import cacheRetentionSupport from "./cache-retention-support.ts";
import type cacheRetentionSupportTypes from "./cache-retention-support.types.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { stream } = compatModule;
const { stream: streamOpenAIResponses } = openaiResponses;

const { capturePayload, context, isolateCacheRetentionEnv } = cacheRetentionSupport;
const { hasEnv } = env;
const { chooseModel, modelsWhere } = modelChoice;

type ResponsesPayload = cacheRetentionSupportTypes.OpenAIResponsesCachePayload;

const implicitCacheModel = chooseModel(
  "openai",
  "implicit prompt cache",
  (candidate) => candidate.compat?.supportsExplicitPromptCacheMode !== true,
);

const explicitCacheModels = modelsWhere(
  "openai",
  (candidate) => candidate.compat?.supportsExplicitPromptCacheMode === true,
);

const explicitCacheModel = chooseModel(
  "openai",
  "explicit prompt cache mode",
  (candidate) => candidate.compat?.supportsExplicitPromptCacheMode === true,
);

const captureLive = capturePayload<ResponsesPayload>((onPayload) =>
  stream(implicitCacheModel, context, { onPayload }),
);

const captureFake = (
  target: typesModule.Model<"openai-responses">,
  options: Omit<typesModule.StreamOptions, "onPayload"> = {},
) =>
  capturePayload<ResponsesPayload>((onPayload) =>
    streamOpenAIResponses(target, context, { apiKey: "sk-fake-key", ...options, onPayload }),
  );

const keepsRetentionUnsetByDefault = Effect.map(captureLive, (payload) => {
  expect(payload).toBeDefined();
  expect(payload?.prompt_cache_retention).toBeUndefined();
});

const usesLongRetentionFromEnv = Effect.suspend(() => {
  vi.stubEnv("MSA_CACHE_RETENTION", "long");
  return Effect.map(captureLive, (payload) => {
    expect(payload?.prompt_cache_retention).toBe("24h");
  });
});

const setsRetentionBehindProxy = Effect.suspend(() => {
  vi.stubEnv("MSA_CACHE_RETENTION", "long");
  return Effect.map(
    captureFake({ ...implicitCacheModel, baseUrl: "https://my-proxy.example.com/v1" }),
    (payload) => {
      expect(payload?.prompt_cache_retention).toBe("24h");
    },
  );
});

const omitsRetentionWithoutLongSupport = Effect.map(
  captureFake(
    { ...implicitCacheModel, compat: { supportsLongCacheRetention: false } },
    { cacheRetention: "long", sessionId: "session-compat-false" },
  ),
  (payload) => {
    expect(payload).toBeDefined();
    expect(payload?.prompt_cache_retention).toBeUndefined();
  },
);

const disablesImplicitWritesWhenNone = Effect.map(
  captureFake(explicitCacheModel, { cacheRetention: "none", sessionId: "session-1" }),
  (payload) => {
    expect(payload?.prompt_cache_key).toBeUndefined();
    expect(payload?.prompt_cache_retention).toBeUndefined();
    expect(payload?.prompt_cache_options).toEqual({ mode: "explicit" });
  },
);

const omitsOptionsForImplicitModels = Effect.map(
  captureFake(implicitCacheModel, { cacheRetention: "none", sessionId: "session-1" }),
  (payload) => {
    expect(payload).toBeDefined();
    expect(payload?.prompt_cache_key).toBeUndefined();
    expect(payload?.prompt_cache_options).toBeUndefined();
  },
);

const longCacheCases = [
  [implicitCacheModel.id, implicitCacheModel, "24h", undefined],
  ...explicitCacheModels.map((model) => [model.id, model, undefined, { ttl: "30m" }] as const),
] as const;

const usesSupportedLongCacheField = (
  model: typesModule.Model<"openai-responses">,
  retention: string | undefined,
  cacheOptions: { readonly ttl: "30m" } | undefined,
) =>
  Effect.map(captureFake(model, { cacheRetention: "long", sessionId: "session-2" }), (payload) => {
    expect(payload?.prompt_cache_key).toBe("session-2");
    expect(payload?.prompt_cache_retention).toBe(retention);
    expect(payload?.prompt_cache_options).toEqual(cacheOptions);
  });

describe("Cache Retention (MSA_CACHE_RETENTION)", () => {
  isolateCacheRetentionEnv();

  describe("OpenAI Responses Provider", () => {
    it.each(explicitCacheModels)(
      "does not enable cache warming from the documented TTL alone for $id",
      (model) => {
        expect(model.promptCache).toBeUndefined();
      },
    );
    it.skipIf(!hasEnv("OPENAI_API_KEY"))(
      "should not set prompt_cache_retention when MSA_CACHE_RETENTION is not set",
      () => Effect.runPromise(keepsRetentionUnsetByDefault),
    );
    it.skipIf(!hasEnv("OPENAI_API_KEY"))(
      "should set prompt_cache_retention to 24h when MSA_CACHE_RETENTION=long",
      () => Effect.runPromise(usesLongRetentionFromEnv),
    );
    it("should set prompt_cache_retention for non-api.openai.com baseUrl by default", () =>
      Effect.runPromise(setsRetentionBehindProxy));
    it("should omit prompt_cache_retention when supportsLongCacheRetention is false", () =>
      Effect.runPromise(omitsRetentionWithoutLongSupport));
    it("should omit prompt_cache_key and disable implicit writes when cacheRetention is none", () =>
      Effect.runPromise(disablesImplicitWritesWhenNone));
    it("should omit prompt_cache_options for models that reject it", () =>
      Effect.runPromise(omitsOptionsForImplicitModels));
    it.each(longCacheCases)(
      "should use the supported long cache field for %s",
      (_id, model, retention, cacheOptions) =>
        Effect.runPromise(usesSupportedLongCacheField(model, retention, cacheOptions)),
    );
  });
});
