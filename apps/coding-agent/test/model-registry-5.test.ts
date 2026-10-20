import type { AnthropicMessagesCompat } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { type ModelRegistry, clearApiKeyCache } from "../src/core/model-registry.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeTempDir, randomSuffixSync, removePath, runTest, writeJsonFile } =
  testing;

let tempDir: string;

let modelsJsonPath: string;

let authStorage: AuthStorage;

function getModelsForProvider(registry: ModelRegistry, provider: string) {
  return registry.getAll().filter((m) => m.provider === provider);
}

const writeRawModelsJson = (providers: Record<string, unknown>) =>
  writeJsonFile(modelsJsonPath, { providers });

const emptyAllowedFallbackModelOverrideDisablesServer = Effect.gen(function* () {
  yield* writeRawModelsJson({
    "anthropic-api": {
      modelOverrides: {
        "claude-fable-5": { compat: { allowedFallbackModels: [] } },
      },
    },
  });

  const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
  const compat = registry.find("anthropic-api", "claude-fable-5")?.compat as
    | AnthropicMessagesCompat
    | undefined;

  expect(registry.getError()).toBeUndefined();
  expect(compat?.allowedFallbackModels).toEqual([]);
});

const customModelsAndModelOverridesCarrySampling = Effect.gen(function* () {
  yield* writeRawModelsJson({
    openrouter: {
      api: "openai-completions",
      baseUrl: "https://my-proxy.example.com/v1",
      modelOverrides: {
        "anthropic/claude-sonnet-4.5": {
          samplingParams: { top_p: 0.9 },
          samplingParamsByThinkingLevel: { high: { temperature: 0.8 } },
        },
        "custom/sampling-model": {
          samplingParamsByThinkingLevel: {
            low: { temperature: 0.5, top_k: 20 },
            max: { temperature: 1 },
          },
        },
      },
      models: [
        {
          id: "custom/sampling-model",
          samplingParams: { temperature: 1, top_k: 0, top_p: 0.95 },
          samplingParamsByThinkingLevel: {
            high: { temperature: 0.8 },
            low: { temperature: 0.6, top_p: 0.95 },
          },
        },
      ],
    },
  });

  const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
  const models = getModelsForProvider(registry, "openrouter");

  const custom = models.find((m) => m.id === "custom/sampling-model");
  expect(custom?.samplingParams).toEqual({ temperature: 1, top_k: 0, top_p: 0.95 });
  expect(custom?.samplingParamsByThinkingLevel).toEqual({
    high: { temperature: 0.8 },
    low: { temperature: 0.5, top_k: 20, top_p: 0.95 },
    max: { temperature: 1 },
  });

  const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
  expect(sonnet?.samplingParams).toEqual({ top_p: 0.9 });
  expect(sonnet?.samplingParamsByThinkingLevel).toEqual({ high: { temperature: 0.8 } });

  const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");
  expect(opus?.samplingParams).toBeUndefined();
  expect(opus?.samplingParamsByThinkingLevel).toBeUndefined();
});

const customModelAndModelOverrideCarryPrompt = Effect.gen(function* () {
  yield* writeRawModelsJson({
    "anthropic-api": {
      modelOverrides: {
        "claude-sonnet-4-6": { promptCache: { long: 1800 } },
      },
    },
    openrouter: {
      api: "openai-completions",
      baseUrl: "https://my-proxy.example.com/v1",
      modelOverrides: {
        "anthropic/claude-sonnet-4.5": { promptCache: { short: 300 } },
      },
      models: [{ id: "custom/cached-model", promptCache: { short: 120 } }],
    },
  });

  const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
  const openrouter = getModelsForProvider(registry, "openrouter");

  expect(registry.getError()).toBeUndefined();
  expect(openrouter.find((m) => m.id === "custom/cached-model")?.promptCache).toEqual({
    short: 120,
  });
  expect(openrouter.find((m) => m.id === "anthropic/claude-sonnet-4.5")?.promptCache).toEqual({
    short: 300,
  });
  expect(openrouter.find((m) => m.id === "anthropic/claude-opus-4.1")?.promptCache).toBeUndefined();

  expect(registry.find("anthropic-api", "claude-sonnet-4-6")?.promptCache).toEqual({
    long: 1800,
    short: 300,
  });
});

const modelOverrideDeepMergesImageResizeLimits = Effect.gen(function* () {
  yield* writeRawModelsJson({
    test: {
      api: "openai-completions",
      apiKey: "test-key",
      baseUrl: "https://example.com",
      modelOverrides: {
        "vision-model": {
          inputLimits: {
            images: { resize: { jpegQuality: 75, maxBytes: 524288, maxWidth: 1568 } },
          },
        },
      },
      models: [
        {
          id: "vision-model",
          input: ["text", "image"],
          inputLimits: {
            images: {
              maxPerRequest: 100,
              resize: {
                jpegQuality: 80,
                maxBytes: 4.5 * 1024 * 1024,
                maxHeight: 2000,
                maxWidth: 2000,
              },
            },
            maxRequestBytes: 32 * 1024 * 1024,
          },
        },
      ],
    },
  });

  const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
  const model = registry.find("test", "vision-model");

  expect(registry.getError()).toBeUndefined();
  expect(model?.inputLimits).toMatchObject({
    images: {
      maxPerRequest: 100,
      resize: { jpegQuality: 75, maxBytes: 524288, maxHeight: 2000, maxWidth: 1568 },
    },
    maxRequestBytes: 32 * 1024 * 1024,
  });
});

const beforeEachHook = () =>
  runTest(makeTempDir(`msa-test-model-registry-${randomSuffixSync()}-`)).then((dir) => {
    tempDir = dir;
    modelsJsonPath = joinPath(tempDir, "models.json");
    authStorage = AuthStorage.inMemory();
    return dir;
  });

const afterEachHook = () => {
  clearApiKeyCache();
  vi.restoreAllMocks();
  return runTest(removePath(tempDir));
};

describe("ModelRegistry", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  describe("modelOverrides (per-model customization)", () => {
    test("empty allowed fallback model override disables server-side fallback", () =>
      runTest(emptyAllowedFallbackModelOverrideDisablesServer));

    test("custom models and model overrides carry sampling params", () =>
      runTest(customModelsAndModelOverridesCarrySampling));

    test("custom model and model override carry prompt cache lifetimes", () =>
      runTest(customModelAndModelOverrideCarryPrompt));

    test("model override deep-merges image resize limits", () =>
      runTest(modelOverrideDeepMergesImageResizeLimits));
  });
});
