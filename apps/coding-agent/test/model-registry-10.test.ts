import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Api, Model } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import {
  clearApiKeyCache,
  type ModelRegistry,
  type ProviderConfigInput,
} from "../src/core/model-registry.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";

describe("ModelRegistry", () => {
  let tempDir: string;

  let modelsJsonPath: string;

  let authStorage: AuthStorage;

  function providerConfig(
    baseUrl: string,
    models: Array<{ id: string; name?: string }>,
    api: string = "anthropic-messages",
  ): ProviderConfigInput {
    return {
      baseUrl,
      apiKey: "test-key",
      api: api as Api,
      models: models.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100000,
        maxTokens: 8000,
      })),
    };
  }

  function getModelsForProvider(registry: ModelRegistry, provider: string) {
    return registry.getAll().filter((m) => m.provider === provider);
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

  describe("dynamic provider lifecycle", () => {
    describe("dynamic provider override persistence", () => {
      test("models-only custom provider registration survives refresh", async () => {
        const registry = await createModelRegistry(authStorage, modelsJsonPath);

        registry.registerProvider(
          "custom-provider",
          providerConfig(
            "https://custom.test/v1",
            [{ id: "custom-a" }, { id: "custom-b" }],
            "openai-completions",
          ),
        );
        await registry.refresh();

        expect(getModelsForProvider(registry, "custom-provider").map((m) => m.id)).toEqual([
          "custom-a",
          "custom-b",
        ]);
      });

      test("baseUrl-only override keeps custom provider models after refresh", async () => {
        const registry = await createModelRegistry(authStorage, modelsJsonPath);

        registry.registerProvider(
          "custom-provider",
          providerConfig(
            "https://custom.test/v1",
            [{ id: "custom-a" }, { id: "custom-b" }],
            "openai-completions",
          ),
        );
        registry.registerProvider("custom-provider", { baseUrl: "https://proxy.test/custom" });
        await registry.refresh();

        expect(getModelsForProvider(registry, "custom-provider").map((m) => m.id)).toEqual([
          "custom-a",
          "custom-b",
        ]);
        expect(
          getModelsForProvider(registry, "custom-provider").every(
            (m) => m.baseUrl === "https://proxy.test/custom",
          ),
        ).toBe(true);
      });

      test("headers-only override keeps custom provider models after refresh", async () => {
        const registry = await createModelRegistry(authStorage, modelsJsonPath);

        registry.registerProvider(
          "custom-provider",
          providerConfig(
            "https://custom.test/v1",
            [{ id: "custom-a" }, { id: "custom-b" }],
            "openai-completions",
          ),
        );
        registry.registerProvider("custom-provider", { headers: { "x-proxy": "enabled" } });
        await registry.refresh();

        const models = getModelsForProvider(registry, "custom-provider");
        expect(models.map((m) => m.id)).toEqual(["custom-a", "custom-b"]);
        expect(models.every((m) => m.baseUrl === "https://custom.test/v1")).toBe(true);
        const [first] = models;
        if (first === undefined) throw new Error("expected custom-provider models");
        expect(await registry.getApiKeyAndHeaders(first)).toMatchObject({
          ok: true,
          headers: { "x-proxy": "enabled" },
        });
      });
    });
  });

  describe("API key resolution", () => {
    test("apiKey with ! prefix executes command and uses stdout", async () => {
      writeRawModelsJson({
        "custom-provider": providerWithApiKey("!echo test-api-key-from-command"),
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const apiKey = await registry.getApiKeyForProvider("custom-provider");

      expect(apiKey).toBe("test-api-key-from-command");
    });

    test("apiKey with ! prefix trims whitespace from command output", async () => {
      writeRawModelsJson({
        "custom-provider": providerWithApiKey("!echo '  spaced-key  '"),
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const apiKey = await registry.getApiKeyForProvider("custom-provider");

      expect(apiKey).toBe("spaced-key");
    });

    test("apiKey with ! prefix handles multiline output (uses trimmed result)", async () => {
      writeRawModelsJson({
        "custom-provider": providerWithApiKey("!printf 'line1\\nline2'"),
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const apiKey = await registry.getApiKeyForProvider("custom-provider");

      expect(apiKey).toBe("line1\nline2");
    });

    test("apiKey with ! prefix returns undefined on command failure", async () => {
      writeRawModelsJson({
        "custom-provider": providerWithApiKey("!exit 1"),
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const apiKey = await registry.getApiKeyForProvider("custom-provider");

      expect(apiKey).toBeUndefined();
    });

    test("apiKey with ! prefix returns undefined on nonexistent command", async () => {
      writeRawModelsJson({
        "custom-provider": providerWithApiKey("!nonexistent-command-12345"),
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const apiKey = await registry.getApiKeyForProvider("custom-provider");

      expect(apiKey).toBeUndefined();
    });

    test("apiKey with ! prefix returns undefined on empty output", async () => {
      writeRawModelsJson({
        "custom-provider": providerWithApiKey("!printf ''"),
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const apiKey = await registry.getApiKeyForProvider("custom-provider");

      expect(apiKey).toBeUndefined();
    });

    test("apiKey with $ prefix resolves to env value", async () => {
      const originalEnv = process.env["TEST_API_KEY_12345"];
      process.env["TEST_API_KEY_12345"] = "env-api-key-value";

      try {
        writeRawModelsJson({
          "custom-provider": providerWithApiKey("$TEST_API_KEY_12345"),
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        const apiKey = await registry.getApiKeyForProvider("custom-provider");

        expect(apiKey).toBe("env-api-key-value");
      } finally {
        if (originalEnv === undefined) {
          delete process.env["TEST_API_KEY_12345"];
        } else {
          process.env["TEST_API_KEY_12345"] = originalEnv;
        }
      }
    });
  });
});
