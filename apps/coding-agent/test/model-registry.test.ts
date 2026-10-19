import type { Api } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import {
  clearApiKeyCache,
  type ModelRegistry,
  type ProviderConfigInput,
} from "../src/core/model-registry.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";
import { Effect } from "effect";
import { nodeFs } from "./model-registry-support.ts";
import { awaited, joinPath, makeTempDir, randomSuffixSync, removePath, runTest} from "@msa/testing";

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

  function overrideConfig(baseUrl: string, headers?: Record<string, string>) {
    return { baseUrl, ...(headers && { headers }) };
  }

  function writeRawModelsJson(providers: Record<string, unknown>) {
    nodeFs.writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
  }

  beforeEach(() =>
    runTest(makeTempDir(`msa-test-model-registry-${randomSuffixSync()}-`)).then((dir) => {
      tempDir = dir;
      modelsJsonPath = joinPath(tempDir, "models.json");
      authStorage = AuthStorage.inMemory();
      return dir;
    }),
  );

  afterEach(() => {
    clearApiKeyCache();
    vi.restoreAllMocks();
    return runTest(removePath(tempDir));
  });

  describe("baseUrl override (no custom models)", () => {
    test("overriding baseUrl keeps all built-in models", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        "anthropic-api": overrideConfig("https://my-proxy.example.com/v1"),
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      expect(anthropicModels.length).toBeGreaterThan(1);
      expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
    
}),
));

    test("overriding baseUrl changes URL on all built-in models", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        "anthropic-api": overrideConfig("https://my-proxy.example.com/v1"),
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      for (const model of anthropicModels) {
        expect(model.baseUrl).toBe("https://my-proxy.example.com/v1");
      }
    
}),
));

    test("overriding headers resolves at request time", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        "anthropic-api": overrideConfig("https://my-proxy.example.com/v1", {
          "X-Custom-Header": "custom-value",
        }),
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      for (const model of anthropicModels) {
        const auth = (yield* awaited(registry.getApiKeyAndHeaders(model)));
        expect(auth.ok).toBe(true);
        if (auth.ok) {
          expect(auth.headers?.["X-Custom-Header"]).toBe("custom-value");
        }
      }
    
}),
));

    test("headers-only override resolves at request time", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        "anthropic-api": {
          headers: {
            "X-Custom-Header": "custom-value",
          },
        },
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      expect(registry.getError()).toBeUndefined();
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      for (const model of anthropicModels) {
        const auth = (yield* awaited(registry.getApiKeyAndHeaders(model)));
        expect(auth.ok).toBe(true);
        if (auth.ok) {
          expect(auth.headers?.["X-Custom-Header"]).toBe("custom-value");
        }
      }
    
}),
));

    test("unconfigured compatibility auth includes static model headers", () => runTest(
Effect.gen(function* () {

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const base = registry.getAll()[0];
      if (base === undefined) throw new Error("expected a registered model");
      const model = {
        ...base,
        provider: "missing-provider",
        headers: { "X-Static-Model": "static-value" },
      };

      const auth = (yield* awaited(registry.getApiKeyAndHeaders(model)));

      expect(auth).toEqual({ ok: true, headers: { "X-Static-Model": "static-value" } });
    
}),
));

    test("baseUrl-only override does not affect other providers", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        "anthropic-api": overrideConfig("https://my-proxy.example.com/v1"),
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const opencodeModels = getModelsForProvider(registry, "opencode");

      expect(opencodeModels.length).toBeGreaterThan(0);
      expect(opencodeModels[0]?.baseUrl).not.toBe("https://my-proxy.example.com/v1");
    
}),
));

    test("can mix baseUrl override and models merge", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        "anthropic-api": overrideConfig("https://anthropic-proxy.example.com/v1"),

        opencode: providerConfig(
          "https://opencode-proxy.example.com/v1",
          [{ id: "gemini-custom" }],
          "google-generative-ai",
        ),
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));

      const anthropicModels = getModelsForProvider(registry, "anthropic-api");
      expect(anthropicModels.length).toBeGreaterThan(1);
      expect(anthropicModels[0]?.baseUrl).toBe("https://anthropic-proxy.example.com/v1");

      const opencodeModels = getModelsForProvider(registry, "opencode");
      expect(opencodeModels.length).toBeGreaterThan(1);
      expect(opencodeModels.some((m) => m.id === "gemini-custom")).toBe(true);
    
}),
));

    test("refresh() picks up baseUrl override changes", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        "anthropic-api": overrideConfig("https://first-proxy.example.com/v1"),
      });
      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));

      expect(getModelsForProvider(registry, "anthropic-api")[0]?.baseUrl).toBe(
        "https://first-proxy.example.com/v1",
      );

      writeRawModelsJson({
        "anthropic-api": overrideConfig("https://second-proxy.example.com/v1"),
      });
      (yield* awaited(registry.refresh()));

      expect(getModelsForProvider(registry, "anthropic-api")[0]?.baseUrl).toBe(
        "https://second-proxy.example.com/v1",
      );
    
}),
));
  });

  describe("custom models merge behavior", () => {
    test("built-in provider custom models inherit api and baseUrl without explicit fields", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        openrouter: {
          models: [
            {
              id: "fake-provider/fake-model",
              name: "Fake model",
              reasoning: true,
              input: ["text"],
            },
          ],
        },
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      expect(registry.getError()).toBeUndefined();

      const model = registry.find("openrouter", "fake-provider/fake-model");
      expect(model).toBeDefined();
      expect(model?.api).toBe("openai-completions");
      expect(model?.baseUrl).toBe("https://openrouter.ai/api/v1");
    
}),
));
  });
});
