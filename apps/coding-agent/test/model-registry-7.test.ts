import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Model } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
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
    test("model override can add headers at request time", async () => {
      writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              headers: { "X-Custom-Model-Header": "value" },
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      expect(sonnet).toBeDefined();

      const auth = await registry.getApiKeyAndHeaders(sonnet!);
      expect(auth.ok).toBe(true);
      if (auth.ok) {
        expect(auth.headers?.["X-Custom-Model-Header"]).toBe("value");
      }
    });

    test("refresh() picks up model override changes", async () => {
      writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "First Name",
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      expect(
        getModelsForProvider(registry, "openrouter").find(
          (m) => m.id === "anthropic/claude-sonnet-4.5",
        )?.name,
      ).toBe("First Name");

      writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Second Name",
            },
          },
        },
      });
      await registry.refresh();

      expect(
        getModelsForProvider(registry, "openrouter").find(
          (m) => m.id === "anthropic/claude-sonnet-4.5",
        )?.name,
      ).toBe("Second Name");
    });

    test("removing model override restores built-in values", async () => {
      writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Custom Name",
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const customName = getModelsForProvider(registry, "openrouter").find(
        (m) => m.id === "anthropic/claude-sonnet-4.5",
      )?.name;
      expect(customName).toBe("Custom Name");

      writeRawModelsJson({});
      await registry.refresh();

      const restoredName = getModelsForProvider(registry, "openrouter").find(
        (m) => m.id === "anthropic/claude-sonnet-4.5",
      )?.name;
      expect(restoredName).not.toBe("Custom Name");
    });
  });

  describe("dynamic provider lifecycle", () => {
    test("getProviderDisplayName resolves registered, OAuth, built-in, and fallback names", async () => {
      const registry = await createModelRegistry(authStorage, modelsJsonPath);

      expect(registry.getProviderDisplayName("openai")).toBe("OpenAI");
      expect(registry.getProviderDisplayName("openai-codex")).toBe("OpenAI Codex (legacy)");
      expect(registry.getProviderDisplayName("unknown-provider")).toBe("unknown-provider");

      registry.registerProvider("named-provider", {
        name: "Named Provider",
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
      expect(registry.getProviderDisplayName("named-provider")).toBe("Named Provider");

      registry.registerProvider("oauth-provider", {
        baseUrl: "https://provider.test/v1",
        api: "openai-completions",
        oauth: {
          name: "OAuth Provider",
          login: async () => ({
            access: "access",
            refresh: "refresh",
            expires: Date.now() + 60_000,
          }),
          refreshToken: async (credentials) => credentials,
          getApiKey: (credentials) => credentials.access,
        },
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
      expect(registry.getProviderDisplayName("oauth-provider")).toBe("OAuth Provider");
    });
  });
});
