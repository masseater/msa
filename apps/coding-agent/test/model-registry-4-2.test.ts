import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { clearApiKeyCache } from "../src/core/model-registry.ts";
import modelRegistry4Support from "./model-registry-4-support.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { getModelsForProvider, providerConfig } = modelRegistry4Support;

const { createModelRegistry } = modelRuntimeTestUtils;

const {
  awaited,
  joinPath,
  makeTempDir,
  randomSuffixSync,
  removePath,
  runTest,
  toJsonText,
  writeJsonFile,
  writeTextFile,
} = testing;

let tempDir: string;

let modelsJsonPath: string;

let authStorage: AuthStorage;

const writeModelsJson = Effect.fn("writeModelsJson")(function* (
  providers: Record<string, ReturnType<typeof providerConfig>>,
) {
  yield* writeTextFile(modelsJsonPath, yield* toJsonText({ providers }));
});

const writeRawModelsJson = (providers: Record<string, unknown>) =>
  writeJsonFile(modelsJsonPath, { providers });

const removingCustomModelsFromModelsJsonKeeps = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeModelsJson({
        "anthropic-api": providerConfig("https://proxy.example.com/v1", [{ id: "claude-custom" }]),
      });
      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      expect(
        getModelsForProvider(registry, "anthropic-api").some((m) => m.id === "claude-custom"),
      ).toBe(true);

      yield* writeModelsJson({});
      yield* awaited(registry.refresh());

      const anthropicModels = getModelsForProvider(registry, "anthropic-api");
      expect(anthropicModels.some((m) => m.id === "claude-custom")).toBe(false);
      expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
    }),
  );

const modelOverrideAppliesToASingleBuilt = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Custom Sonnet Name",
            },
          },
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const models = getModelsForProvider(registry, "openrouter");

      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      expect(sonnet?.name).toBe("Custom Sonnet Name");

      const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");
      expect(opus?.name).not.toBe("Custom Sonnet Name");
    }),
  );

const anthropicModelOverrideReplacesAllowedFallbackMetadata = () =>
  runTest(
    Effect.gen(function* () {
      const allowedFallbackModels = [
        {
          cost: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
          model: "claude-opus-5",
          provider: "anthropic-api",
        },
        {
          cost: { cacheRead: 0.4, cacheWrite: 5, input: 4, output: 20 },
          model: "claude-opus-4-8",
          provider: "anthropic-api",
        },
      ];
      yield* writeRawModelsJson({
        "anthropic-api": {
          modelOverrides: {
            "claude-fable-5": {
              compat: { allowedFallbackModels },
            },
          },
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const compat = registry.find("anthropic-api", "claude-fable-5")?.compat as
        | compatTypes.AnthropicMessagesCompat
        | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(compat?.allowedFallbackModels).toEqual(allowedFallbackModels);
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

  describe("custom models merge behavior", () => {
    test(
      "removing custom models from models.json keeps built-in provider models",
      removingCustomModelsFromModelsJsonKeeps,
    );
  });

  describe("modelOverrides (per-model customization)", () => {
    test("model override applies to a single built-in model", modelOverrideAppliesToASingleBuilt);

    test(
      "Anthropic model override replaces allowed fallback metadata",
      anthropicModelOverrideReplacesAllowedFallbackMetadata,
    );
  });
});
