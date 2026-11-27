import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import platform from "../src/core/platform/index.ts";
import modelRegistrySupport from "./model-registry-support.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { toShPath, providerWithApiKey, useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();
const { deleteEnv, readEnv, writeEnv } = platform;

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, readTextFile, runTest, writeTextFile } = testing;

const commandsAreReExecutedAcrossRegistryInstances = () =>
  runTest(
    Effect.gen(function* () {
      const counterFile = joinPath(fixture.tempDir, "counter");
      yield* writeTextFile(counterFile, "0");

      const counterPath = toShPath(counterFile);
      const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
      yield* fixture.writeRawModelsJson({
        "custom-provider": providerWithApiKey(command),
      });

      const registry1 = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      yield* awaited(registry1.getApiKeyForProvider("custom-provider"));

      const registry2 = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      yield* awaited(registry2.getApiKeyForProvider("custom-provider"));

      const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
      expect(count).toBe(2);
    }),
  );

const differentCommandsResolveIndependently = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "provider-a": providerWithApiKey("!echo key-a"),
        "provider-b": providerWithApiKey("!echo key-b"),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );

      const keyA = yield* awaited(registry.getApiKeyForProvider("provider-a"));
      const keyB = yield* awaited(registry.getApiKeyForProvider("provider-b"));

      expect(keyA).toBe("key-a");
      expect(keyB).toBe("key-b");
    }),
  );

const failedCommandsAreRetried = () =>
  runTest(
    Effect.gen(function* () {
      const counterFile = joinPath(fixture.tempDir, "counter");
      yield* writeTextFile(counterFile, "0");

      const counterPath = toShPath(counterFile);
      const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; exit 1'`;
      yield* fixture.writeRawModelsJson({
        "custom-provider": providerWithApiKey(command),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
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

        yield* fixture.writeRawModelsJson({
          "custom-provider": providerWithApiKey(`$${envVarName}`),
        });

        const registry = yield* awaited(
          createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
        );

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
        yield* fixture.writeRawModelsJson({
          "custom-provider": providerWithApiKey(interpolatedKey),
        });

        const registry = yield* awaited(
          createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
        );

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
      yield* fixture.writeRawModelsJson({
        "custom-provider": providerWithApiKey("literal_api_key_value"),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );

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
        yield* fixture.writeRawModelsJson({
          "custom-provider": providerWithApiKey(`$${envVarName}`),
        });

        const registry = yield* awaited(
          createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
        );

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

describe("ModelRegistry", () => {
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
