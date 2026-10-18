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
    test("apiKey with braced env syntax resolves to env value", async () => {
      const originalEnv = process.env["TEST_BRACED_API_KEY_12345"];
      process.env["TEST_BRACED_API_KEY_12345"] = "braced-env-api-key-value";
      const bracedKey = "${TEST_BRACED_API_KEY_12345}";

      try {
        writeRawModelsJson({
          "custom-provider": providerWithApiKey(bracedKey),
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        const apiKey = await registry.getApiKeyForProvider("custom-provider");

        expect(apiKey).toBe("braced-env-api-key-value");
      } finally {
        if (originalEnv === undefined) {
          delete process.env["TEST_BRACED_API_KEY_12345"];
        } else {
          process.env["TEST_BRACED_API_KEY_12345"] = originalEnv;
        }
      }
    });

    test("apiKey interpolates braced env references inside literals", async () => {
      const originalPartA = process.env["TEST_INTERPOLATED_PART_A_12345"];
      const originalPartB = process.env["TEST_INTERPOLATED_PART_B_12345"];
      process.env["TEST_INTERPOLATED_PART_A_12345"] = "left";
      process.env["TEST_INTERPOLATED_PART_B_12345"] = "right";
      const interpolatedKey = [
        "$",
        "{TEST_INTERPOLATED_PART_A_12345}_$",
        "{TEST_INTERPOLATED_PART_B_12345}",
      ].join("");

      try {
        writeRawModelsJson({
          "custom-provider": providerWithApiKey(interpolatedKey),
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        const apiKey = await registry.getApiKeyForProvider("custom-provider");

        expect(apiKey).toBe("left_right");
      } finally {
        if (originalPartA === undefined) {
          delete process.env["TEST_INTERPOLATED_PART_A_12345"];
        } else {
          process.env["TEST_INTERPOLATED_PART_A_12345"] = originalPartA;
        }
        if (originalPartB === undefined) {
          delete process.env["TEST_INTERPOLATED_PART_B_12345"];
        } else {
          process.env["TEST_INTERPOLATED_PART_B_12345"] = originalPartB;
        }
      }
    });

    test("apiKey with $$ prefix escapes a leading dollar", async () => {
      writeRawModelsJson({
        "custom-provider": providerWithApiKey("$$TEST_API_KEY_12345"),
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const apiKey = await registry.getApiKeyForProvider("custom-provider");

      expect(apiKey).toBe("$TEST_API_KEY_12345");
    });

    test("apiKey with $! escapes a literal bang and still interpolates later env refs", async () => {
      const originalEnv = process.env["TEST_API_KEY_12345"];
      process.env["TEST_API_KEY_12345"] = "env-api-key-value";

      try {
        writeRawModelsJson({
          "custom-provider": providerWithApiKey("$!literal-$TEST_API_KEY_12345"),
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        const apiKey = await registry.getApiKeyForProvider("custom-provider");

        expect(apiKey).toBe("!literal-env-api-key-value");
      } finally {
        if (originalEnv === undefined) {
          delete process.env["TEST_API_KEY_12345"];
        } else {
          process.env["TEST_API_KEY_12345"] = originalEnv;
        }
      }
    });

    test("plain apiKey is used directly even when it matches an env var", async () => {
      const originalEnv = process.env["TEST_API_KEY_12345"];
      process.env["TEST_API_KEY_12345"] = "env-api-key-value";

      try {
        writeRawModelsJson({
          "custom-provider": providerWithApiKey("TEST_API_KEY_12345"),
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        const apiKey = await registry.getApiKeyForProvider("custom-provider");

        expect(apiKey).toBe("TEST_API_KEY_12345");
      } finally {
        if (originalEnv === undefined) {
          delete process.env["TEST_API_KEY_12345"];
        } else {
          process.env["TEST_API_KEY_12345"] = originalEnv;
        }
      }
    });

    test("apiKey as literal value is used directly when not an env var", async () => {
      delete process.env["literal_api_key_value"];

      writeRawModelsJson({
        "custom-provider": providerWithApiKey("literal_api_key_value"),
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const apiKey = await registry.getApiKeyForProvider("custom-provider");

      expect(apiKey).toBe("literal_api_key_value");
    });

    test("apiKey command can use shell features like pipes", async () => {
      writeRawModelsJson({
        "custom-provider": providerWithApiKey("!echo 'hello world' | tr ' ' '-'"),
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const apiKey = await registry.getApiKeyForProvider("custom-provider");

      expect(apiKey).toBe("hello-world");
    });

    describe("request-time resolution", () => {
      test("command is executed on every provider lookup", async () => {
        const counterFile = join(tempDir, "counter");
        writeFileSync(counterFile, "0");

        const counterPath = toShPath(counterFile);
        const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
        writeRawModelsJson({
          "custom-provider": providerWithApiKey(command),
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        await registry.getApiKeyForProvider("custom-provider");
        await registry.getApiKeyForProvider("custom-provider");
        await registry.getApiKeyForProvider("custom-provider");

        const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
        expect(count).toBe(3);
      });
    });
  });
});
