import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AnthropicMessagesCompat, Api, Model } from "@msa/ai/compat";
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

  function writeModelsJson(providers: Record<string, ReturnType<typeof providerConfig>>) {
    writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
  }

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

  describe("custom models merge behavior", () => {
    test("model-level baseUrl overrides provider-level baseUrl for custom models", async () => {
      writeRawModelsJson({
        "opencode-go": {
          baseUrl: "https://opencode.ai/zen/go/v1",
          apiKey: "TEST_KEY",
          models: [
            {
              id: "minimax-m2.5",
              api: "anthropic-messages",
              baseUrl: "https://opencode.ai/zen/go",
              reasoning: true,
              input: ["text"],
              cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 },
              contextWindow: 204800,
              maxTokens: 131072,
            },
            {
              id: "glm-5",
              api: "openai-completions",
              reasoning: true,
              input: ["text"],
              cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
              contextWindow: 204800,
              maxTokens: 131072,
            },
          ],
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const m25 = registry.find("opencode-go", "minimax-m2.5");
      const glm5 = registry.find("opencode-go", "glm-5");

      expect(m25?.baseUrl).toBe("https://opencode.ai/zen/go");
      expect(glm5?.baseUrl).toBe("https://opencode.ai/zen/go/v1");
    });

    test("modelOverrides still apply when provider also defines models", async () => {
      writeRawModelsJson({
        openrouter: {
          baseUrl: "https://my-proxy.example.com/v1",
          apiKey: "OPENROUTER_API_KEY",
          api: "openai-completions",
          models: [
            {
              id: "custom/openrouter-model",
              name: "Custom OpenRouter Model",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 16384,
            },
          ],
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Overridden Built-in Sonnet",
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const models = getModelsForProvider(registry, "openrouter");

      expect(models.some((m) => m.id === "custom/openrouter-model")).toBe(true);
      expect(
        models.some(
          (m) => m.id === "anthropic/claude-sonnet-4.5" && m.name === "Overridden Built-in Sonnet",
        ),
      ).toBe(true);
    });

    test("refresh() reloads merged custom models from disk", async () => {
      writeModelsJson({
        anthropic: providerConfig("https://first-proxy.example.com/v1", [{ id: "claude-custom" }]),
      });
      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      expect(
        getModelsForProvider(registry, "anthropic").some((m) => m.id === "claude-custom"),
      ).toBe(true);

      writeModelsJson({
        anthropic: providerConfig("https://second-proxy.example.com/v1", [
          { id: "claude-custom-2" },
        ]),
      });
      await registry.refresh();

      const anthropicModels = getModelsForProvider(registry, "anthropic");
      expect(anthropicModels.some((m) => m.id === "claude-custom")).toBe(false);
      expect(anthropicModels.some((m) => m.id === "claude-custom-2")).toBe(true);
      expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
    });

    test("removing custom models from models.json keeps built-in provider models", async () => {
      writeModelsJson({
        anthropic: providerConfig("https://proxy.example.com/v1", [{ id: "claude-custom" }]),
      });
      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      expect(
        getModelsForProvider(registry, "anthropic").some((m) => m.id === "claude-custom"),
      ).toBe(true);

      writeModelsJson({});
      await registry.refresh();

      const anthropicModels = getModelsForProvider(registry, "anthropic");
      expect(anthropicModels.some((m) => m.id === "claude-custom")).toBe(false);
      expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
    });
  });

  describe("modelOverrides (per-model customization)", () => {
    test("model override applies to a single built-in model", async () => {
      writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Custom Sonnet Name",
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const models = getModelsForProvider(registry, "openrouter");

      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      expect(sonnet?.name).toBe("Custom Sonnet Name");

      const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");
      expect(opus?.name).not.toBe("Custom Sonnet Name");
    });

    test("Anthropic model override replaces allowed fallback metadata", async () => {
      const allowedFallbackModels = [
        {
          provider: "anthropic",
          model: "claude-opus-5",
          cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        },
        {
          provider: "anthropic",
          model: "claude-opus-4-8",
          cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
        },
      ];
      writeRawModelsJson({
        anthropic: {
          modelOverrides: {
            "claude-fable-5": {
              compat: { allowedFallbackModels },
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const compat = registry.find("anthropic", "claude-fable-5")?.compat as
        | AnthropicMessagesCompat
        | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(compat?.allowedFallbackModels).toEqual(allowedFallbackModels);
    });
  });
});
