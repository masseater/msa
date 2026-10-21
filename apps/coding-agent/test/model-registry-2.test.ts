import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import type authStorageTypes from "../src/core/auth-storage.types.ts";
import type modelRegistryTypes from "../src/core/model-registry.types.ts";
import providerAuth from "../src/core/provider-composer/provider-auth.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
const { clearApiKeyCache } = providerAuth;

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

let authStorage: authStorageTypes.AuthStorage;

function providerConfig(
  baseUrl: string,
  models: Array<{ id: string; name?: string }>,
  api: string = "anthropic-messages",
): modelRegistryTypes.ProviderConfigInput {
  return {
    api: api as compatTypes.Api,
    apiKey: "test-key",
    baseUrl,
    models: models.map((m) => ({
      contextWindow: 100000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: m.id,
      input: ["text"],
      maxTokens: 8000,
      name: m.name ?? m.id,
      reasoning: false,
    })),
  };
}

const writeModelsJson = Effect.fn("writeModelsJson")(function* (
  providers: Record<string, ReturnType<typeof providerConfig>>,
) {
  yield* writeTextFile(modelsJsonPath, yield* toJsonText({ providers }));
});

function getModelsForProvider(registry: modelRegistryTypes.ModelRegistry, provider: string) {
  return registry.getAll().filter((m) => m.provider === provider);
}

const writeRawModelsJson = (providers: Record<string, unknown>) =>
  writeJsonFile(modelsJsonPath, { providers });

const nonBuiltInProviderCustomModelsStill = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "my-custom-provider": {
          apiKey: "test-key",
          models: [
            {
              api: "openai-completions",
              id: "my-model",
              input: ["text"],
              reasoning: false,
            },
          ],
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      expect(registry.getError()).toContain("baseUrl");
    }),
  );

const reportsEveryProviderCompositionError = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "broken-one": { api: "openai-completions", models: [{ id: "one" }] },
        "broken-two": { api: "openai-completions", models: [{ id: "two" }] },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const error = registry.getError();

      expect(error).toContain('Provider "broken-one"');
      expect(error).toContain('Provider "broken-two"');
    }),
  );

const customProviderWithSameNameAsBuilt = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeModelsJson({
        "anthropic-api": providerConfig("https://my-proxy.example.com/v1", [
          { id: "claude-custom" },
        ]),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      expect(anthropicModels.length).toBeGreaterThan(1);
      expect(anthropicModels.some((m) => m.id === "claude-custom")).toBe(true);
      expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
    }),
  );

const customModelWithSameIdReplacesBuilt = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeModelsJson({
        openrouter: providerConfig(
          "https://my-proxy.example.com/v1",
          [{ id: "anthropic/claude-sonnet-4.5" }],
          "openai-completions",
        ),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const models = getModelsForProvider(registry, "openrouter");
      const sonnetModels = models.filter((m) => m.id === "anthropic/claude-sonnet-4.5");

      expect(sonnetModels).toHaveLength(1);
      expect(sonnetModels[0]?.baseUrl).toBe("https://my-proxy.example.com/v1");
    }),
  );

const customProviderWithSameNameAsBuilt2 = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeModelsJson({
        "anthropic-api": providerConfig("https://my-proxy.example.com/v1", [
          { id: "claude-custom" },
        ]),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

      expect(getModelsForProvider(registry, "opencode").length).toBeGreaterThan(0);
      expect(getModelsForProvider(registry, "openai").length).toBeGreaterThan(0);
    }),
  );

const providerLevelBaseurlAppliesToBothBuilt = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeModelsJson({
        "anthropic-api": providerConfig("https://merged-proxy.example.com/v1", [
          { id: "claude-custom" },
        ]),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      for (const model of anthropicModels) {
        expect(model.baseUrl).toBe("https://merged-proxy.example.com/v1");
      }
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
      "non-built-in provider custom models still require baseUrl",
      nonBuiltInProviderCustomModelsStill,
    );

    test("reports every provider composition error", reportsEveryProviderCompositionError);

    test(
      "custom provider with same name as built-in merges with built-in models",
      customProviderWithSameNameAsBuilt,
    );
  });
});

describe("ModelRegistry", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  describe("custom models merge behavior", () => {
    test(
      "custom model with same id replaces built-in model by id",
      customModelWithSameIdReplacesBuilt,
    );

    test(
      "custom provider with same name as built-in does not affect other built-in providers",
      customProviderWithSameNameAsBuilt2,
    );

    test(
      "provider-level baseUrl applies to both built-in and custom models",
      providerLevelBaseurlAppliesToBothBuilt,
    );
  });
});
