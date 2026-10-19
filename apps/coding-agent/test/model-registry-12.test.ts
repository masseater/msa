import {
  awaited,
  joinPath,
  makeTempDir,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { clearApiKeyCache } from "../src/core/model-registry.ts";
import { deleteEnv, readEnv, writeEnv } from "../src/core/process-env.ts";
import { nodeFs } from "./model-registry-support.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";

describe("ModelRegistry", () => {
  let tempDir: string;

  let modelsJsonPath: string;

  let authStorage: AuthStorage;

  function toShPath(value: string): string {
    return value.replace(/\\/gu, "/").replace(/"/gu, '\\"');
  }

  function writeRawModelsJson(providers: Record<string, unknown>) {
    nodeFs.writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
  }

  function providerWithApiKey(apiKey: string) {
    return {
      baseUrl: "https://example.com/v1",
      apiKey,
      api: "anthropic-messages",
      models: [
        {
          id: "test-model",
          name: "Test Model",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 100000,
          maxTokens: 8000,
        },
      ],
    };
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

  describe("API key resolution", () => {
    describe("request-time resolution", () => {
      test("commands are re-executed across registry instances", () =>
        runTest(
          Effect.gen(function* () {
            const counterFile = joinPath(tempDir, "counter");
            yield* writeTextFile(counterFile, "0");

            const counterPath = toShPath(counterFile);
            const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
            writeRawModelsJson({
              "custom-provider": providerWithApiKey(command),
            });

            const registry1 = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            yield* awaited(registry1.getApiKeyForProvider("custom-provider"));

            const registry2 = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            yield* awaited(registry2.getApiKeyForProvider("custom-provider"));

            const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
            expect(count).toBe(2);
          }),
        ));

      test("different commands resolve independently", () =>
        runTest(
          Effect.gen(function* () {
            writeRawModelsJson({
              "provider-a": providerWithApiKey("!echo key-a"),
              "provider-b": providerWithApiKey("!echo key-b"),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            const keyA = yield* awaited(registry.getApiKeyForProvider("provider-a"));
            const keyB = yield* awaited(registry.getApiKeyForProvider("provider-b"));

            expect(keyA).toBe("key-a");
            expect(keyB).toBe("key-b");
          }),
        ));

      test("failed commands are retried", () =>
        runTest(
          Effect.gen(function* () {
            const counterFile = joinPath(tempDir, "counter");
            yield* writeTextFile(counterFile, "0");

            const counterPath = toShPath(counterFile);
            const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; exit 1'`;
            writeRawModelsJson({
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
        ));

      test("provider auth status reports apiKey environment variables from models.json", () =>
        runTest(
          Effect.gen(function* () {
            const envVarName = "TEST_API_KEY_STATUS_TEST_98765";
            const originalEnv = readEnv(envVarName);

            try {
              writeEnv(envVarName, "status-test-key");

              writeRawModelsJson({
                "custom-provider": providerWithApiKey(`$${envVarName}`),
              });

              const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

              expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
                configured: true,
                source: "environment",
                label: envVarName,
              });
            } finally {
              if (originalEnv === undefined) {
                deleteEnv(envVarName);
              } else {
                writeEnv(envVarName, originalEnv);
              }
            }
          }),
        ));

      test("provider auth status reports interpolated apiKey environment variables", () =>
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
              writeRawModelsJson({
                "custom-provider": providerWithApiKey(interpolatedKey),
              });

              const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

              expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
                configured: true,
                source: "environment",
                label: `${envVarNameA}, ${envVarNameB}`,
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
        ));

      test("provider auth status reports non-env apiKey values from models.json as a config key", () =>
        runTest(
          Effect.gen(function* () {
            writeRawModelsJson({
              "custom-provider": providerWithApiKey("literal_api_key_value"),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
              configured: true,
              source: "models_json_key",
            });
          }),
        ));

      test("missing explicit env apiKey keeps provider unavailable", () =>
        runTest(
          Effect.gen(function* () {
            const envVarName = "TEST_API_KEY_MISSING_TEST_98765";
            const originalEnv = readEnv(envVarName);
            deleteEnv(envVarName);

            try {
              writeRawModelsJson({
                "custom-provider": providerWithApiKey(`$${envVarName}`),
              });

              const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

              expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
                configured: false,
              });
              expect(
                registry.getAvailable().some((model) => model.provider === "custom-provider"),
              ).toBe(false);
            } finally {
              if (originalEnv === undefined) {
                deleteEnv(envVarName);
              } else {
                writeEnv(envVarName, originalEnv);
              }
            }
          }),
        ));
    });
  });
});
