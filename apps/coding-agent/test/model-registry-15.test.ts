import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import type authStorageTypes from "../src/core/auth-storage.types.ts";
import providerComposer from "../src/core/provider-composer.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
const { clearApiKeyCache } = providerComposer;

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeTempDir, randomSuffixSync, removePath, runTest, writeJsonFile } =
  testing;

let tempDir: string;

let modelsJsonPath: string;

let authStorage: authStorageTypes.AuthStorage;

const writeRawModelsJson = (providers: Record<string, unknown>) =>
  writeJsonFile(modelsJsonPath, { providers });

const builtInProviderCustomModelsInheritApi = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        openrouter: {
          models: [
            {
              id: "fake-provider/fake-model",
              input: ["text"],
              name: "Fake model",
              reasoning: true,
            },
          ],
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      expect(registry.getError()).toBeUndefined();

      const model = registry.find("openrouter", "fake-provider/fake-model");
      expect(model).toBeDefined();
      expect(model?.api).toBe("openai-completions");
      expect(model?.baseUrl).toBe("https://openrouter.ai/api/v1");
    }),
  );

const beforeEachHook2 = () =>
  runTest(makeTempDir(`msa-test-model-registry-${randomSuffixSync()}-`)).then((dir) => {
    tempDir = dir;
    modelsJsonPath = joinPath(tempDir, "models.json");
    authStorage = AuthStorage.inMemory();
    return dir;
  });

const afterEachHook2 = () => {
  clearApiKeyCache();
  vi.restoreAllMocks();
  return runTest(removePath(tempDir));
};

describe("ModelRegistry", () => {
  beforeEach(beforeEachHook2);

  afterEach(afterEachHook2);

  describe("custom models merge behavior", () => {
    test(
      "built-in provider custom models inherit api and baseUrl without explicit fields",
      builtInProviderCustomModelsInheritApi,
    );
  });
});
