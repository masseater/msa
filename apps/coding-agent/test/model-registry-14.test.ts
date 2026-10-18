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
      test("stored credentials bypass lower-priority configured auth commands", async () => {
        const counterFile = join(tempDir, "fallback-counter");
        writeFileSync(counterFile, "0");
        const counterPath = toShPath(counterFile);
        writeRawModelsJson({
          "custom-provider": providerWithApiKey(
            `!sh -c 'echo 1 > "${counterPath}"; echo fallback-key'`,
          ),
        });
        await authStorage.modify("custom-provider", async () => ({
          type: "api_key",
          key: "stored-key",
        }));

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        const auth = await registry.getApiKeyAndHeaders(
          registry.find("custom-provider", "test-model")!,
        );

        expect(auth).toMatchObject({ ok: true, apiKey: "stored-key" });
        expect(readFileSync(counterFile, "utf-8").trim()).toBe("0");
      });

      test("getApiKeyAndHeaders preserves the legacy missing-key authHeader error", async () => {
        writeRawModelsJson({
          "custom-provider": {
            baseUrl: "https://example.test/v1",
            api: "openai-completions",
            authHeader: true,
            models: [{ id: "test-model" }],
          },
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        const auth = await registry.getApiKeyAndHeaders(
          registry.find("custom-provider", "test-model")!,
        );

        expect(auth).toEqual({ ok: false, error: 'No API key found for "custom-provider"' });
      });

      test("getApiKeyAndHeaders returns an error for failed authHeader resolution", async () => {
        writeRawModelsJson({
          "custom-provider": {
            ...providerWithApiKey("!exit 1"),
            authHeader: true,
          },
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        const model = registry.find("custom-provider", "test-model");
        expect(model).toBeDefined();

        const auth = await registry.getApiKeyAndHeaders(model!);
        expect(auth.ok).toBe(false);
        if (!auth.ok) {
          expect(auth.error).toContain('Failed to resolve API key for provider "custom-provider"');
        }
      });
    });
  });
});
