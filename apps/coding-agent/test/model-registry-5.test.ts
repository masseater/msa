import type { AnthropicMessagesCompat } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { clearApiKeyCache, type ModelRegistry } from "../src/core/model-registry.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";
import { Effect } from "effect";
import { nodeFs } from "./model-registry-support.ts";
import { awaited, joinPath, makeTempDir, randomSuffixSync, removePath, runTest} from "@msa/testing";

describe("ModelRegistry", () => {
  let tempDir: string;

  let modelsJsonPath: string;

  let authStorage: AuthStorage;

  function getModelsForProvider(registry: ModelRegistry, provider: string) {
    return registry.getAll().filter((m) => m.provider === provider);
  }

  function writeRawModelsJson(providers: Record<string, unknown>) {
    nodeFs.writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
  }

  beforeEach(() =>
    runTest(makeTempDir(`msa-test-model-registry-${randomSuffixSync()}-`)).then((dir) => {
      tempDir = dir;
      modelsJsonPath = joinPath(tempDir, "models.json");
      authStorage = AuthStorage.inMemory();
      return dir;
    }),
  );

  afterEach(() => {
    clearApiKeyCache();
    vi.restoreAllMocks();
    return runTest(removePath(tempDir));
  });

  describe("modelOverrides (per-model customization)", () => {
    test("empty allowed fallback model override disables server-side fallback", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        "anthropic-api": {
          modelOverrides: {
            "claude-fable-5": { compat: { allowedFallbackModels: [] } },
          },
        },
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const compat = registry.find("anthropic-api", "claude-fable-5")?.compat as
        | AnthropicMessagesCompat
        | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(compat?.allowedFallbackModels).toEqual([]);
    
}),
));

    test("custom models and model overrides carry sampling params", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        openrouter: {
          baseUrl: "https://my-proxy.example.com/v1",
          api: "openai-completions",
          models: [
            {
              id: "custom/sampling-model",
              samplingParams: { temperature: 1, top_p: 0.95, top_k: 0 },
              samplingParamsByThinkingLevel: {
                low: { temperature: 0.6, top_p: 0.95 },
                high: { temperature: 0.8 },
              },
            },
          ],
          modelOverrides: {
            "custom/sampling-model": {
              samplingParamsByThinkingLevel: {
                low: { temperature: 0.5, top_k: 20 },
                max: { temperature: 1 },
              },
            },
            "anthropic/claude-sonnet-4.5": {
              samplingParams: { top_p: 0.9 },
              samplingParamsByThinkingLevel: { high: { temperature: 0.8 } },
            },
          },
        },
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const models = getModelsForProvider(registry, "openrouter");

      const custom = models.find((m) => m.id === "custom/sampling-model");
      expect(custom?.samplingParams).toEqual({ temperature: 1, top_p: 0.95, top_k: 0 });
      expect(custom?.samplingParamsByThinkingLevel).toEqual({
        low: { temperature: 0.5, top_p: 0.95, top_k: 20 },
        high: { temperature: 0.8 },
        max: { temperature: 1 },
      });

      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      expect(sonnet?.samplingParams).toEqual({ top_p: 0.9 });
      expect(sonnet?.samplingParamsByThinkingLevel).toEqual({ high: { temperature: 0.8 } });

      const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");
      expect(opus?.samplingParams).toBeUndefined();
      expect(opus?.samplingParamsByThinkingLevel).toBeUndefined();
    
}),
));

    test("custom model and model override carry prompt cache lifetimes", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        openrouter: {
          baseUrl: "https://my-proxy.example.com/v1",
          api: "openai-completions",
          models: [{ id: "custom/cached-model", promptCache: { short: 120 } }],
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": { promptCache: { short: 300 } },
          },
        },
        "anthropic-api": {
          modelOverrides: {
            "claude-sonnet-4-6": { promptCache: { long: 1800 } },
          },
        },
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const openrouter = getModelsForProvider(registry, "openrouter");

      expect(registry.getError()).toBeUndefined();
      expect(openrouter.find((m) => m.id === "custom/cached-model")?.promptCache).toEqual({
        short: 120,
      });
      expect(openrouter.find((m) => m.id === "anthropic/claude-sonnet-4.5")?.promptCache).toEqual({
        short: 300,
      });
      expect(
        openrouter.find((m) => m.id === "anthropic/claude-opus-4.1")?.promptCache,
      ).toBeUndefined();

      expect(registry.find("anthropic-api", "claude-sonnet-4-6")?.promptCache).toEqual({
        short: 300,
        long: 1800,
      });
    
}),
));

    test("model override deep-merges image resize limits", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        test: {
          baseUrl: "https://example.com",
          apiKey: "test-key",
          api: "openai-completions",
          models: [
            {
              id: "vision-model",
              input: ["text", "image"],
              inputLimits: {
                maxRequestBytes: 32 * 1024 * 1024,
                images: {
                  maxPerRequest: 100,
                  resize: {
                    maxWidth: 2000,
                    maxHeight: 2000,
                    maxBytes: 4.5 * 1024 * 1024,
                    jpegQuality: 80,
                  },
                },
              },
            },
          ],
          modelOverrides: {
            "vision-model": {
              inputLimits: {
                images: { resize: { maxWidth: 1568, maxBytes: 524288, jpegQuality: 75 } },
              },
            },
          },
        },
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const model = registry.find("test", "vision-model");

      expect(registry.getError()).toBeUndefined();
      expect(model?.inputLimits).toMatchObject({
        maxRequestBytes: 32 * 1024 * 1024,
        images: {
          maxPerRequest: 100,
          resize: { maxWidth: 1568, maxHeight: 2000, maxBytes: 524288, jpegQuality: 75 },
        },
      });
    
}),
));
  });
});
