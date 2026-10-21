import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import type authStorageTypes from "../src/core/auth-storage.types.ts";
import processEnv from "../src/core/process-env.ts";
import providerAuth from "../src/core/provider-composer/provider-auth.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
const { deleteEnv, readEnv, writeEnv } = processEnv;
const { clearApiKeyCache } = providerAuth;

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeTempDir, randomSuffixSync, removePath, runTest, writeJsonFile } =
  testing;

let tempDir: string;

let modelsJsonPath: string;

let authStorage: authStorageTypes.AuthStorage;

const writeRawModelsJson = (providers: Record<string, unknown>) =>
  writeJsonFile(modelsJsonPath, { providers });

function providerWithApiKey(apiKey: string) {
  return {
    api: "anthropic-messages",
    apiKey,
    baseUrl: "https://example.com/v1",
    models: [
      {
        contextWindow: 100000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "test-model",
        input: ["text"],
        maxTokens: 8000,
        name: "Test Model",
        reasoning: false,
      },
    ],
  };
}

const apikeyWithPrefixExecutesCommandAndUses = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey("!echo test-api-key-from-command"),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBe("test-api-key-from-command");
    }),
  );

const apikeyWithPrefixTrimsWhitespaceFromCommand = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey("!echo '  spaced-key  '"),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBe("spaced-key");
    }),
  );

const apikeyWithPrefixHandlesMultilineOutputUses = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey("!printf 'line1\\nline2'"),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBe("line1\nline2");
    }),
  );

const apikeyWithPrefixReturnsUndefinedOnCommand = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey("!exit 1"),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBeUndefined();
    }),
  );

const apikeyWithPrefixReturnsUndefinedOnNonexistent = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey("!nonexistent-command-12345"),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBeUndefined();
    }),
  );

const apikeyWithPrefixReturnsUndefinedOnEmpty = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey("!printf ''"),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBeUndefined();
    }),
  );

const apikeyWithPrefixResolvesToEnvValue = () =>
  runTest(
    Effect.gen(function* () {
      const originalEnv = readEnv("TEST_API_KEY_12345");
      writeEnv("TEST_API_KEY_12345", "env-api-key-value");

      try {
        yield* writeRawModelsJson({
          "custom-provider": providerWithApiKey("$TEST_API_KEY_12345"),
        });

        const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
        const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

        expect(apiKey).toBe("env-api-key-value");
      } finally {
        if (originalEnv === undefined) {
          deleteEnv("TEST_API_KEY_12345");
        } else {
          writeEnv("TEST_API_KEY_12345", originalEnv);
        }
      }
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

  describe("API key resolution", () => {
    test(
      "apiKey with ! prefix executes command and uses stdout",
      apikeyWithPrefixExecutesCommandAndUses,
    );

    test(
      "apiKey with ! prefix trims whitespace from command output",
      apikeyWithPrefixTrimsWhitespaceFromCommand,
    );

    test(
      "apiKey with ! prefix handles multiline output (uses trimmed result)",
      apikeyWithPrefixHandlesMultilineOutputUses,
    );

    test(
      "apiKey with ! prefix returns undefined on command failure",
      apikeyWithPrefixReturnsUndefinedOnCommand,
    );

    test(
      "apiKey with ! prefix returns undefined on nonexistent command",
      apikeyWithPrefixReturnsUndefinedOnNonexistent,
    );

    test(
      "apiKey with ! prefix returns undefined on empty output",
      apikeyWithPrefixReturnsUndefinedOnEmpty,
    );

    test("apiKey with $ prefix resolves to env value", apikeyWithPrefixResolvesToEnvValue);
  });
});
