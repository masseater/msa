import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OpenAICompletionsCompat } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { type ModelsJsonProvider } from "../src/core/model-config.ts";
import { clearApiKeyCache, type ModelRegistry } from "../src/core/model-registry.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";

describe("ModelRegistry", () => {
  let tempDir: string;

  let modelsJsonPath: string;

  let authStorage: AuthStorage;

  function getModelsForProvider(registry: ModelRegistry, provider: string) {
    return registry.getAll().filter((m) => m.provider === provider);
  }

  function writeRawModelsJson(providers: Record<string, unknown>) {
    writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
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

  describe("modelOverrides (per-model customization)", () => {
    test("model override with compat.openRouterRouting", async () => {
      writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              compat: {
                openRouterRouting: { only: ["amazon-bedrock"] },
              },
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const models = getModelsForProvider(registry, "openrouter");

      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      const compat = sonnet?.compat as OpenAICompletionsCompat | undefined;
      expect(compat?.openRouterRouting).toEqual({ only: ["amazon-bedrock"] });
    });

    test("supportsFinishReason can be configured at provider and model levels", async () => {
      const provider: ModelsJsonProvider = {
        compat: { supportsFinishReason: true },
        modelOverrides: {
          "anthropic/claude-sonnet-4.5": {
            compat: { supportsFinishReason: false },
          },
        },
      };
      writeRawModelsJson({ openrouter: provider });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((model) => model.id === "anthropic/claude-sonnet-4.5");
      const opus = models.find((model) => model.id === "anthropic/claude-opus-4.1");

      expect((sonnet?.compat as OpenAICompletionsCompat | undefined)?.supportsFinishReason).toBe(
        false,
      );
      expect((opus?.compat as OpenAICompletionsCompat | undefined)?.supportsFinishReason).toBe(
        true,
      );
    });

    test("model override deep merges compat settings", async () => {
      writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              compat: {
                openRouterRouting: { order: ["anthropic", "together"] },
              },
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

      const compat = sonnet?.compat as OpenAICompletionsCompat | undefined;
      expect(compat?.openRouterRouting).toEqual({ order: ["anthropic", "together"] });
    });

    test("multiple model overrides on same provider", async () => {
      writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              compat: { openRouterRouting: { only: ["amazon-bedrock"] } },
            },
            "anthropic/claude-opus-4.1": {
              compat: { openRouterRouting: { only: ["anthropic"] } },
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const models = getModelsForProvider(registry, "openrouter");

      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");

      const sonnetCompat = sonnet?.compat as OpenAICompletionsCompat | undefined;
      const opusCompat = opus?.compat as OpenAICompletionsCompat | undefined;
      expect(sonnetCompat?.openRouterRouting).toEqual({ only: ["amazon-bedrock"] });
      expect(opusCompat?.openRouterRouting).toEqual({ only: ["anthropic"] });
    });

    test("model override combined with baseUrl override", async () => {
      writeRawModelsJson({
        openrouter: {
          baseUrl: "https://my-proxy.example.com/v1",
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Proxied Sonnet",
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

      expect(sonnet?.baseUrl).toBe("https://my-proxy.example.com/v1");
      expect(sonnet?.name).toBe("Proxied Sonnet");

      const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");
      expect(opus?.baseUrl).toBe("https://my-proxy.example.com/v1");
      expect(opus?.name).not.toBe("Proxied Sonnet");
    });

    test("model override for non-existent model ID is ignored", async () => {
      writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "nonexistent/model-id": {
              name: "This should not appear",
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const models = getModelsForProvider(registry, "openrouter");

      expect(models.find((m) => m.id === "nonexistent/model-id")).toBeUndefined();

      expect(registry.getError()).toBeUndefined();
    });

    test("model override can change cost fields partially", async () => {
      writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              cost: { input: 99 },
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

      expect(sonnet?.cost.input).toBe(99);

      expect(sonnet?.cost.output).toBeGreaterThan(0);
    });
  });
});
