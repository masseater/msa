import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import { stream } from "../src/compat.ts";
import type { Model, StreamOptions } from "../src/types.ts";
import cacheRetentionSupport from "./cache-retention-support.ts";
import type cacheRetentionSupportTypes from "./cache-retention-support.types.ts";
import env from "./env.ts";
import modelChoice from "./model-choice.ts";

const { capturePayload, context, isolateCacheRetentionEnv } = cacheRetentionSupport;
const { hasEnv } = env;
const { chooseModel } = modelChoice;

type AnthropicCachePayload = cacheRetentionSupportTypes.AnthropicCachePayload;

const model = chooseModel(
  "anthropic-api",
  "long cache retention",
  (candidate) => candidate.compat?.supportsLongCacheRetention !== false,
);

const proxyBaseUrl = "https://my-proxy.example.com/v1";

const captureLive = capturePayload<AnthropicCachePayload>((onPayload) =>
  stream(model, context, { onPayload }),
);

const captureFake = (
  target: Model<"anthropic-messages">,
  options: Omit<StreamOptions, "onPayload"> = {},
) =>
  capturePayload<AnthropicCachePayload>((onPayload) =>
    streamAnthropic(target, context, { apiKey: "fake-key", ...options, onPayload }),
  );

const systemCacheControl = (payload: AnthropicCachePayload | undefined) =>
  payload?.system?.[0]?.cache_control;

const lastUserBlockCacheControl = (payload: AnthropicCachePayload | undefined) => {
  const content = payload?.messages.findLast((message) => message.role === "user")?.content;
  expect(Array.isArray(content)).toBe(true);
  return Array.isArray(content) ? content.at(-1)?.cache_control : undefined;
};

const usesDefaultTtl = Effect.map(captureLive, (payload) => {
  expect(systemCacheControl(payload)).toEqual({ type: "ephemeral" });
});

const usesLongTtlFromEnv = Effect.suspend(() => {
  vi.stubEnv("MSA_CACHE_RETENTION", "long");
  return Effect.map(captureLive, (payload) => {
    expect(systemCacheControl(payload)).toEqual({ ttl: "1h", type: "ephemeral" });
  });
});

const addsTtlBehindProxy = Effect.suspend(() => {
  vi.stubEnv("MSA_CACHE_RETENTION", "long");
  return Effect.map(captureFake({ ...model, baseUrl: proxyBaseUrl }), (payload) => {
    expect(systemCacheControl(payload)).toEqual({ ttl: "1h", type: "ephemeral" });
  });
});

const omitsTtlWithoutLongRetention = Effect.map(
  captureFake(
    { ...model, baseUrl: proxyBaseUrl, compat: { supportsLongCacheRetention: false } },
    { cacheRetention: "long" },
  ),
  (payload) => {
    expect(systemCacheControl(payload)).toEqual({ type: "ephemeral" });
  },
);

const omitsCacheControlWhenNone = Effect.map(
  captureFake(model, { cacheRetention: "none" }),
  (payload) => {
    expect(payload).toBeDefined();
    expect(systemCacheControl(payload)).toBeUndefined();
  },
);

const marksStringUserMessages = Effect.map(captureFake(model), (payload) => {
  expect(lastUserBlockCacheControl(payload)).toEqual({ type: "ephemeral" });
});

const usesLongTtlFromOption = Effect.map(
  captureFake(model, { cacheRetention: "long" }),
  (payload) => {
    expect(systemCacheControl(payload)).toEqual({ ttl: "1h", type: "ephemeral" });
  },
);

describe("Cache Retention (MSA_CACHE_RETENTION)", () => {
  isolateCacheRetentionEnv();

  describe("Anthropic Provider", () => {
    it.skipIf(!hasEnv("ANTHROPIC_API_KEY"))(
      "should use default cache TTL (no ttl field) when MSA_CACHE_RETENTION is not set",
      () => Effect.runPromise(usesDefaultTtl),
    );
    it.skipIf(!hasEnv("ANTHROPIC_API_KEY"))(
      "should use 1h cache TTL when MSA_CACHE_RETENTION=long",
      () => Effect.runPromise(usesLongTtlFromEnv),
    );
    it("should add ttl for non-api.anthropic.com baseUrl by default", () =>
      Effect.runPromise(addsTtlBehindProxy));
    it("should omit ttl when supportsLongCacheRetention is false", () =>
      Effect.runPromise(omitsTtlWithoutLongRetention));
    it("should omit cache_control when cacheRetention is none", () =>
      Effect.runPromise(omitsCacheControlWhenNone));
    it("should add cache_control to string user messages", () =>
      Effect.runPromise(marksStringUserMessages));
    it("should set 1h cache TTL when cacheRetention is long", () =>
      Effect.runPromise(usesLongTtlFromOption));
  });
});
