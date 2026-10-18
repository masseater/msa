import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Api, Model } from "@msa/ai/compat";
import { getSupportedThinkingLevels } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { clearApiKeyCache, type ProviderConfigInput } from "../src/core/model-registry.ts";
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

  describe("dynamic provider lifecycle", () => {
    test("modelOverrides apply to dynamically registered provider models", async () => {
      writeRawModelsJson({
        "extension-provider": {
          modelOverrides: {
            "extension-model": {
              name: "Overridden Extension Model",
              thinkingLevelMap: {
                off: null,
                minimal: null,
                low: null,
                medium: null,
                xhigh: "max",
              },
              headers: { "x-model-override": "enabled" },
            },
          },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      registry.registerProvider("extension-provider", {
        baseUrl: "https://provider.test/v1",
        apiKey: "test-key",
        api: "openai-completions",
        models: [
          {
            id: "extension-model",
            name: "Extension Model",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          },
        ],
      });

      const model = registry.find("extension-provider", "extension-model");
      expect(model).toBeDefined();
      if (!model) {
        throw new Error("extension model was not registered");
      }
      expect(model.name).toBe("Overridden Extension Model");
      expect(model.thinkingLevelMap).toEqual({
        off: null,
        minimal: null,
        low: null,
        medium: null,
        xhigh: "max",
      });
      expect(getSupportedThinkingLevels(model)).toEqual(["high", "xhigh"]);
      expect(await registry.getApiKeyAndHeaders(model)).toMatchObject({
        ok: true,
        headers: { "x-model-override": "enabled" },
      });
    });

    test("stored API key env propagates to request auth and resolves headers", async () => {
      await authStorage.modify("openrouter", async () => ({
        type: "api_key",
        key: "stored-openrouter-key",
        env: { OPENROUTER_TEAM: "stored-team" },
      }));
      writeRawModelsJson({
        openrouter: {
          headers: { "x-team": "$OPENROUTER_TEAM" },
        },
      });

      const registry = await createModelRegistry(authStorage, modelsJsonPath);
      const model = registry.getAll().find((m) => m.provider === "openrouter");
      expect(model).toBeDefined();

      const auth = await registry.getApiKeyAndHeaders(model!);

      expect(auth).toEqual({
        ok: true,
        apiKey: "stored-openrouter-key",
        headers: { "x-team": "stored-team" },
        env: { OPENROUTER_TEAM: "stored-team" },
      });
    });

    test("registerProvider treats uppercase apiKey and headers as literals", async () => {
      const envKeys = ["CUSTOM_NAME", "BEARER", "MODEL_TOKEN"];
      const savedEnv: Record<string, string | undefined> = {};
      for (const key of envKeys) {
        savedEnv[key] = process.env[key];
        process.env[key] = `env-${key}`;
      }
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const registry = await createModelRegistry(authStorage, modelsJsonPath);

        registry.registerProvider("literal-provider", {
          ...providerConfig(
            "https://provider.test/v1",
            [{ id: "demo-model" }],
            "openai-completions",
          ),
          apiKey: "CUSTOM_NAME",
          headers: { Authorization: "BEARER" },
          models: [
            {
              id: "demo-model",
              name: "demo-model",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 100000,
              maxTokens: 8000,
              headers: { "x-model-token": "MODEL_TOKEN" },
            },
          ],
        });

        expect(await registry.getApiKeyForProvider("literal-provider")).toBe("CUSTOM_NAME");
        const model = registry.find("literal-provider", "demo-model");
        expect(model).toBeDefined();
        expect(await registry.getApiKeyAndHeaders(model!)).toMatchObject({
          ok: true,
          apiKey: "CUSTOM_NAME",
          headers: {
            Authorization: "BEARER",
            "x-model-token": "MODEL_TOKEN",
          },
        });
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        for (const key of envKeys) {
          if (savedEnv[key] === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = savedEnv[key];
          }
        }
      }
    });

    test("failed registerProvider does not persist invalid streamSimple config", async () => {
      const registry = await createModelRegistry(authStorage, modelsJsonPath);

      expect(() =>
        registry.registerProvider("broken-provider", {
          streamSimple: (() => {
            throw new Error("should not run");
          }) as any,
        }),
      ).toThrow('Provider broken-provider: "api" is required when registering streamSimple.');

      await expect(registry.refresh()).resolves.toMatchObject({ aborted: false });
    });
  });
});
