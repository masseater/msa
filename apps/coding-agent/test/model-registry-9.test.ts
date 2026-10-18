import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Api, Model } from "@msa/ai/compat";
import { getApiProvider } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import {
  clearApiKeyCache,
  type ModelRegistry,
  type ProviderConfigInput,
} from "../src/core/model-registry.ts";
import { openAiModel, emptyContext } from "./model-registry-support.ts";
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
    test("failed registerProvider does not remove existing provider models", async () => {
      const registry = await createModelRegistry(authStorage, modelsJsonPath);

      registry.registerProvider("demo-provider", {
        baseUrl: "https://provider.test/v1",
        apiKey: "test-key",
        api: "openai-completions",
        models: [
          {
            id: "demo-model",
            name: "Demo Model",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          },
        ],
      });

      expect(registry.find("demo-provider", "demo-model")).toBeDefined();

      expect(() =>
        registry.registerProvider("demo-provider", {
          baseUrl: "https://provider.test/v2",
          apiKey: "test-key",
          models: [
            {
              id: "broken-model",
              name: "Broken Model",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 4096,
            },
          ],
        }),
      ).toThrow('Provider demo-provider, model broken-model: no "api" specified.');

      expect(registry.find("demo-provider", "demo-model")).toBeDefined();
      await expect(registry.refresh()).resolves.toMatchObject({ aborted: false });
      expect(registry.find("demo-provider", "demo-model")).toBeDefined();
    });

    test("unregisterProvider removes the runtime OAuth overlay without mutating global state", async () => {
      const registry = await createModelRegistry(authStorage, modelsJsonPath);

      registry.registerProvider("anthropic", {
        oauth: {
          name: "Custom Anthropic OAuth",
          login: async () => ({
            access: "custom-access-token",
            refresh: "custom-refresh-token",
            expires: Date.now() + 60_000,
          }),
          refreshToken: async (credentials) => credentials,
          getApiKey: (credentials) => credentials.access,
        },
      });

      expect(registry.getRegisteredProviderConfig("anthropic")?.oauth?.name).toBe(
        "Custom Anthropic OAuth",
      );

      registry.unregisterProvider("anthropic");

      expect(registry.getRegisteredProviderConfig("anthropic")).toBeUndefined();
    });

    test("streamSimple overlays do not mutate the global compat API registry", async () => {
      const registry = await createModelRegistry(authStorage, modelsJsonPath);

      registry.registerProvider("stream-override-provider", {
        api: "openai-completions",
        streamSimple: () => {
          throw new Error("custom streamSimple override");
        },
      });

      let threwCustomOverride = false;
      try {
        getApiProvider("openai-completions")?.streamSimple(openAiModel, emptyContext);
      } catch (error) {
        threwCustomOverride =
          error instanceof Error && error.message === "custom streamSimple override";
      }
      expect(threwCustomOverride).toBe(false);

      registry.unregisterProvider("stream-override-provider");

      let threwCustomOverrideAfterUnregister = false;
      try {
        getApiProvider("openai-completions")?.streamSimple(openAiModel, emptyContext);
      } catch (error) {
        threwCustomOverrideAfterUnregister =
          error instanceof Error && error.message === "custom streamSimple override";
      }
      expect(threwCustomOverrideAfterUnregister).toBe(false);
    });

    describe("dynamic provider override persistence", () => {
      test("baseUrl-only override keeps built-in provider models after refresh", async () => {
        const registry = await createModelRegistry(authStorage, modelsJsonPath);

        registry.registerProvider("anthropic", { baseUrl: "https://proxy.test/anthropic" });
        await registry.refresh();

        const anthropicModels = getModelsForProvider(registry, "anthropic");
        expect(anthropicModels.length).toBeGreaterThan(1);
        expect(anthropicModels.every((m) => m.baseUrl === "https://proxy.test/anthropic")).toBe(
          true,
        );
      });

      test("models-only override replaces built-in provider models after refresh", async () => {
        const registry = await createModelRegistry(authStorage, modelsJsonPath);

        registry.registerProvider("anthropic", {
          ...providerConfig(
            "https://custom.test/anthropic",
            [{ id: "custom-claude" }],
            "anthropic-messages",
          ),
          baseUrl: "https://custom.test/anthropic",
        });
        await registry.refresh();

        expect(getModelsForProvider(registry, "anthropic").map((m) => m.id)).toEqual([
          "custom-claude",
        ]);
        expect(registry.find("anthropic", "custom-claude")?.baseUrl).toBe(
          "https://custom.test/anthropic",
        );
      });

      test("models plus baseUrl override replaces built-in provider models after refresh", async () => {
        const registry = await createModelRegistry(authStorage, modelsJsonPath);

        registry.registerProvider("anthropic", {
          ...providerConfig(
            "https://custom.test/anthropic",
            [{ id: "custom-claude" }],
            "anthropic-messages",
          ),
          baseUrl: "https://custom.test/anthropic",
        });
        registry.registerProvider("anthropic", { baseUrl: "https://proxy.test/anthropic" });
        await registry.refresh();

        expect(getModelsForProvider(registry, "anthropic").map((m) => m.id)).toEqual([
          "custom-claude",
        ]);
        expect(registry.find("anthropic", "custom-claude")?.baseUrl).toBe(
          "https://proxy.test/anthropic",
        );
      });
    });
  });
});
