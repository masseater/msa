import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Model } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { clearApiKeyCache } from "../src/core/model-registry.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";

describe("ModelRegistry", () => {
  let tempDir: string;

  let modelsJsonPath: string;

  let authStorage: AuthStorage;

  function toShPath(value: string): string {
    return value.replace(/\\/g, "/").replace(/"/g, '\\"');
  }

  function writeRawModelsJson(providers: Record<string, unknown>) {
    writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
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

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `msa-test-model-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
    modelsJsonPath = join(tempDir, "models.json");
    authStorage = AuthStorage.inMemory();
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
    clearApiKeyCache();
    vi.restoreAllMocks();
  });

  describe("API key resolution", () => {
    describe("request-time resolution", () => {
      test("commands are re-executed across registry instances", async () => {
        const counterFile = join(tempDir, "counter");
        writeFileSync(counterFile, "0");

        const counterPath = toShPath(counterFile);
        const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
        writeRawModelsJson({
          "custom-provider": providerWithApiKey(command),
        });

        const registry1 = await createModelRegistry(authStorage, modelsJsonPath);
        await registry1.getApiKeyForProvider("custom-provider");

        const registry2 = await createModelRegistry(authStorage, modelsJsonPath);
        await registry2.getApiKeyForProvider("custom-provider");

        const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
        expect(count).toBe(2);
      });

      test("different commands resolve independently", async () => {
        writeRawModelsJson({
          "provider-a": providerWithApiKey("!echo key-a"),
          "provider-b": providerWithApiKey("!echo key-b"),
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);

        const keyA = await registry.getApiKeyForProvider("provider-a");
        const keyB = await registry.getApiKeyForProvider("provider-b");

        expect(keyA).toBe("key-a");
        expect(keyB).toBe("key-b");
      });

      test("failed commands are retried", async () => {
        const counterFile = join(tempDir, "counter");
        writeFileSync(counterFile, "0");

        const counterPath = toShPath(counterFile);
        const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; exit 1'`;
        writeRawModelsJson({
          "custom-provider": providerWithApiKey(command),
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        const key1 = await registry.getApiKeyForProvider("custom-provider");
        const key2 = await registry.getApiKeyForProvider("custom-provider");

        expect(key1).toBeUndefined();
        expect(key2).toBeUndefined();

        const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
        expect(count).toBe(2);
      });

      test("provider auth status reports apiKey environment variables from models.json", async () => {
        const envVarName = "TEST_API_KEY_STATUS_TEST_98765";
        const originalEnv = process.env[envVarName];

        try {
          process.env[envVarName] = "status-test-key";

          writeRawModelsJson({
            "custom-provider": providerWithApiKey(`$${envVarName}`),
          });

          const registry = await createModelRegistry(authStorage, modelsJsonPath);

          expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
            configured: true,
            source: "environment",
            label: envVarName,
          });
        } finally {
          if (originalEnv === undefined) {
            delete process.env[envVarName];
          } else {
            process.env[envVarName] = originalEnv;
          }
        }
      });

      test("provider auth status reports interpolated apiKey environment variables", async () => {
        const envVarNameA = "TEST_API_KEY_STATUS_PART_A_98765";
        const envVarNameB = "TEST_API_KEY_STATUS_PART_B_98765";
        const originalEnvA = process.env[envVarNameA];
        const originalEnvB = process.env[envVarNameB];
        process.env[envVarNameA] = "left";
        process.env[envVarNameB] = "right";
        const interpolatedKey = ["$", "{", envVarNameA, "}_$", "{", envVarNameB, "}"].join("");

        try {
          writeRawModelsJson({
            "custom-provider": providerWithApiKey(interpolatedKey),
          });

          const registry = await createModelRegistry(authStorage, modelsJsonPath);

          expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
            configured: true,
            source: "environment",
            label: `${envVarNameA}, ${envVarNameB}`,
          });
        } finally {
          if (originalEnvA === undefined) {
            delete process.env[envVarNameA];
          } else {
            process.env[envVarNameA] = originalEnvA;
          }
          if (originalEnvB === undefined) {
            delete process.env[envVarNameB];
          } else {
            process.env[envVarNameB] = originalEnvB;
          }
        }
      });

      test("provider auth status reports non-env apiKey values from models.json as a config key", async () => {
        writeRawModelsJson({
          "custom-provider": providerWithApiKey("literal_api_key_value"),
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);

        expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
          configured: true,
          source: "models_json_key",
        });
      });

      test("missing explicit env apiKey keeps provider unavailable", async () => {
        const envVarName = "TEST_API_KEY_MISSING_TEST_98765";
        const originalEnv = process.env[envVarName];
        delete process.env[envVarName];

        try {
          writeRawModelsJson({
            "custom-provider": providerWithApiKey(`$${envVarName}`),
          });

          const registry = await createModelRegistry(authStorage, modelsJsonPath);

          expect(registry.getProviderAuthStatus("custom-provider")).toEqual({ configured: false });
          expect(
            registry.getAvailable().some((model) => model.provider === "custom-provider"),
          ).toBe(false);
        } finally {
          if (originalEnv === undefined) {
            delete process.env[envVarName];
          } else {
            process.env[envVarName] = originalEnv;
          }
        }
      });
    });
  });
});
