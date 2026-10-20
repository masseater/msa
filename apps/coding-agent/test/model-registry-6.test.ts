import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { type ModelsJsonProvider } from "../src/core/model-config.ts";
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

const modelOverrideWithCompatOpenrouterrouting = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              compat: {
                openRouterRouting: { only: ["amazon-bedrock"] },
              },
            },
          },
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const models = getModelsForProvider(registry, "openrouter");

      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      const compat = sonnet?.compat as compatTypes.OpenAICompletionsCompat | undefined;
      expect(compat?.openRouterRouting).toEqual({ only: ["amazon-bedrock"] });
    }),
  );

const supportsfinishreasonCanBeConfiguredAtProviderAnd = () =>
  runTest(
    Effect.gen(function* () {
      const provider: ModelsJsonProvider = {
        compat: { supportsFinishReason: true },
        modelOverrides: {
          "anthropic/claude-sonnet-4.5": {
            compat: { supportsFinishReason: false },
          },
        },
      };
      yield* writeRawModelsJson({ openrouter: provider });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((model) => model.id === "anthropic/claude-sonnet-4.5");
      const opus = models.find((model) => model.id === "anthropic/claude-opus-4.1");

      expect(
        (sonnet?.compat as compatTypes.OpenAICompletionsCompat | undefined)?.supportsFinishReason,
      ).toBe(false);
      expect(
        (opus?.compat as compatTypes.OpenAICompletionsCompat | undefined)?.supportsFinishReason,
      ).toBe(true);
    }),
  );

const modelOverrideDeepMergesCompatSettings = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              compat: {
                openRouterRouting: { order: ["anthropic-api", "together"] },
              },
            },
          },
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

      const compat = sonnet?.compat as compatTypes.OpenAICompletionsCompat | undefined;
      expect(compat?.openRouterRouting).toEqual({ order: ["anthropic-api", "together"] });
    }),
  );

const multipleModelOverridesOnSameProvider = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-opus-4.1": {
              compat: { openRouterRouting: { only: ["anthropic-api"] } },
            },
            "anthropic/claude-sonnet-4.5": {
              compat: { openRouterRouting: { only: ["amazon-bedrock"] } },
            },
          },
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const models = getModelsForProvider(registry, "openrouter");

      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");

      const sonnetCompat = sonnet?.compat as compatTypes.OpenAICompletionsCompat | undefined;
      const opusCompat = opus?.compat as compatTypes.OpenAICompletionsCompat | undefined;
      expect(sonnetCompat?.openRouterRouting).toEqual({ only: ["amazon-bedrock"] });
      expect(opusCompat?.openRouterRouting).toEqual({ only: ["anthropic-api"] });
    }),
  );

const modelOverrideCombinedWithBaseurlOverride = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        openrouter: {
          baseUrl: "https://my-proxy.example.com/v1",
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Proxied Sonnet",
            },
          },
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

      expect(sonnet?.baseUrl).toBe("https://my-proxy.example.com/v1");
      expect(sonnet?.name).toBe("Proxied Sonnet");

      const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");
      expect(opus?.baseUrl).toBe("https://my-proxy.example.com/v1");
      expect(opus?.name).not.toBe("Proxied Sonnet");
    }),
  );

const modelOverrideForNonExistentModelId = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "nonexistent/model-id": {
              name: "This should not appear",
            },
          },
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const models = getModelsForProvider(registry, "openrouter");

      expect(models.find((m) => m.id === "nonexistent/model-id")).toBeUndefined();

      expect(registry.getError()).toBeUndefined();
    }),
  );

const modelOverrideCanChangeCostFieldsPartially = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              cost: { input: 99 },
            },
          },
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

      expect(sonnet?.cost.input).toBe(99);

      expect(sonnet?.cost.output).toBeGreaterThan(0);
    }),
  );

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
    test("model override with compat.openRouterRouting", modelOverrideWithCompatOpenrouterrouting);

    test(
      "supportsFinishReason can be configured at provider and model levels",
      supportsfinishreasonCanBeConfiguredAtProviderAnd,
    );

    test("model override deep merges compat settings", modelOverrideDeepMergesCompatSettings);

    test("multiple model overrides on same provider", multipleModelOverridesOnSameProvider);

    test("model override combined with baseUrl override", modelOverrideCombinedWithBaseurlOverride);

    test("model override for non-existent model ID is ignored", modelOverrideForNonExistentModelId);

    test(
      "model override can change cost fields partially",
      modelOverrideCanChangeCostFieldsPartially,
    );
  });
});
