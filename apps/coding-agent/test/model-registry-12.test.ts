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

const {
  awaited,
  joinPath,
  makeTempDir,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  writeJsonFile,
  writeTextFile,
} = testing;

let tempDir: string;

let modelsJsonPath: string;

let authStorage: authStorageTypes.AuthStorage;

function toShPath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/"/gu, '\\"');
}

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

const commandsAreReExecutedAcrossRegistryInstances = () =>
  runTest(
    Effect.gen(function* () {
      const counterFile = joinPath(tempDir, "counter");
      yield* writeTextFile(counterFile, "0");

      const counterPath = toShPath(counterFile);
      const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey(command),
      });

      const registry1 = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      yield* awaited(registry1.getApiKeyForProvider("custom-provider"));

      const registry2 = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      yield* awaited(registry2.getApiKeyForProvider("custom-provider"));

      const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
      expect(count).toBe(2);
    }),
  );

const differentCommandsResolveIndependently = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "provider-a": providerWithApiKey("!echo key-a"),
        "provider-b": providerWithApiKey("!echo key-b"),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

      const keyA = yield* awaited(registry.getApiKeyForProvider("provider-a"));
      const keyB = yield* awaited(registry.getApiKeyForProvider("provider-b"));

      expect(keyA).toBe("key-a");
      expect(keyB).toBe("key-b");
    }),
  );

const failedCommandsAreRetried = () =>
  runTest(
    Effect.gen(function* () {
      const counterFile = joinPath(tempDir, "counter");
      yield* writeTextFile(counterFile, "0");

      const counterPath = toShPath(counterFile);
      const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; exit 1'`;
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey(command),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const key1 = yield* awaited(registry.getApiKeyForProvider("custom-provider"));
      const key2 = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(key1).toBeUndefined();
      expect(key2).toBeUndefined();

      const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
      expect(count).toBe(2);
    }),
  );

const providerAuthStatusReportsApikeyEnvironmentVariables = () =>
  runTest(
    Effect.gen(function* () {
      const envVarName = "TEST_API_KEY_STATUS_TEST_98765";
      const originalEnv = readEnv(envVarName);

      try {
        writeEnv(envVarName, "status-test-key");

        yield* writeRawModelsJson({
          "custom-provider": providerWithApiKey(`$${envVarName}`),
        });

        const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

        expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
          configured: true,
          label: envVarName,
          source: "environment",
        });
      } finally {
        if (originalEnv === undefined) {
          deleteEnv(envVarName);
        } else {
          writeEnv(envVarName, originalEnv);
        }
      }
    }),
  );

const providerAuthStatusReportsInterpolatedApikeyEnvironment = () =>
  runTest(
    Effect.gen(function* () {
      const envVarNameA = "TEST_API_KEY_STATUS_PART_A_98765";
      const envVarNameB = "TEST_API_KEY_STATUS_PART_B_98765";
      const originalEnvA = readEnv(envVarNameA);
      const originalEnvB = readEnv(envVarNameB);
      writeEnv(envVarNameA, "left");
      writeEnv(envVarNameB, "right");
      const interpolatedKey = ["$", "{", envVarNameA, "}_$", "{", envVarNameB, "}"].join("");

      try {
        yield* writeRawModelsJson({
          "custom-provider": providerWithApiKey(interpolatedKey),
        });

        const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

        expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
          configured: true,
          label: `${envVarNameA}, ${envVarNameB}`,
          source: "environment",
        });
      } finally {
        if (originalEnvA === undefined) {
          deleteEnv(envVarNameA);
        } else {
          writeEnv(envVarNameA, originalEnvA);
        }
        if (originalEnvB === undefined) {
          deleteEnv(envVarNameB);
        } else {
          writeEnv(envVarNameB, originalEnvB);
        }
      }
    }),
  );

const providerAuthStatusReportsNonEnvApikey = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey("literal_api_key_value"),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

      expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
        configured: true,
        source: "models_json_key",
      });
    }),
  );

const missingExplicitEnvApikeyKeepsProviderUnavailable = () =>
  runTest(
    Effect.gen(function* () {
      const envVarName = "TEST_API_KEY_MISSING_TEST_98765";
      const originalEnv = readEnv(envVarName);
      deleteEnv(envVarName);

      try {
        yield* writeRawModelsJson({
          "custom-provider": providerWithApiKey(`$${envVarName}`),
        });

        const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

        expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
          configured: false,
        });
        expect(registry.getAvailable().some((model) => model.provider === "custom-provider")).toBe(
          false,
        );
      } finally {
        if (originalEnv === undefined) {
          deleteEnv(envVarName);
        } else {
          writeEnv(envVarName, originalEnv);
        }
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

  describe("API key resolution", () => {
    describe("request-time resolution", () => {
      test(
        "commands are re-executed across registry instances",
        commandsAreReExecutedAcrossRegistryInstances,
      );

      test("different commands resolve independently", differentCommandsResolveIndependently);

      test("failed commands are retried", failedCommandsAreRetried);

      test(
        "provider auth status reports apiKey environment variables from models.json",
        providerAuthStatusReportsApikeyEnvironmentVariables,
      );

      test(
        "provider auth status reports interpolated apiKey environment variables",
        providerAuthStatusReportsInterpolatedApikeyEnvironment,
      );

      test(
        "provider auth status reports non-env apiKey values from models.json as a config key",
        providerAuthStatusReportsNonEnvApikey,
      );

      test(
        "missing explicit env apiKey keeps provider unavailable",
        missingExplicitEnvApikeyKeepsProviderUnavailable,
      );
    });
  });
});
