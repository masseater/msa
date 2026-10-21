import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import type authStorageTypes from "../src/core/auth-storage.types.ts";
import providerAuth from "../src/core/provider-composer/provider-auth.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
const { clearApiKeyCache } = providerAuth;

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeTempDir, randomSuffixSync, removePath, runTest, writeJsonFile } =
  testing;

let tempDir: string;

let modelsJsonPath: string;

let authStorage: authStorageTypes.AuthStorage;

const writeRawModelsJson = (providers: Record<string, unknown>) =>
  writeJsonFile(modelsJsonPath, { providers });

const providerLevelCompatAppliesToCustomModels = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        demo: {
          api: "openai-completions",
          apiKey: "DEMO_KEY",
          baseUrl: "https://example.com/v1",
          compat: {
            maxTokensField: "max_tokens",
            supportsUsageInStreaming: false,
          },
          models: [
            {
              contextWindow: 1000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "demo-model",
              input: ["text"],
              maxTokens: 100,
              reasoning: false,
            },
          ],
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const compat = registry.find("demo", "demo-model")?.compat as
        | compatTypes.OpenAICompletionsCompat
        | undefined;

      expect(compat?.supportsUsageInStreaming).toBe(false);
      expect(compat?.maxTokensField).toBe("max_tokens");
    }),
  );

const modelLevelCompatOverridesProviderLevelCompat = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        demo: {
          api: "openai-completions",
          apiKey: "DEMO_KEY",
          baseUrl: "https://example.com/v1",
          compat: {
            maxTokensField: "max_tokens",
            supportsUsageInStreaming: false,
          },
          models: [
            {
              compat: {
                maxTokensField: "max_completion_tokens",
                supportsUsageInStreaming: true,
              },
              contextWindow: 1000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "demo-model",
              input: ["text"],
              maxTokens: 100,
              reasoning: false,
            },
          ],
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const compat = registry.find("demo", "demo-model")?.compat as
        | compatTypes.OpenAICompletionsCompat
        | undefined;

      expect(compat?.supportsUsageInStreaming).toBe(true);
      expect(compat?.maxTokensField).toBe("max_completion_tokens");
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
      "provider-level compat applies to custom models",
      providerLevelCompatAppliesToCustomModels,
    );

    test(
      "model-level compat overrides provider-level compat for custom models",
      modelLevelCompatOverridesProviderLevelCompat,
    );
  });
});
