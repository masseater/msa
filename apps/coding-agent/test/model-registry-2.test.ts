import type { Api, OpenAICompletionsCompat } from "@msa/ai/compat";
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

  function writeModelsJson(providers: Record<string, ReturnType<typeof providerConfig>>) {
    nodeFs.writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
  }

  function getModelsForProvider(registry: ModelRegistry, provider: string) {
    return registry.getAll().filter((m) => m.provider === provider);
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

  describe("custom models merge behavior", () => {
    test("non-built-in provider custom models still require baseUrl", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        "my-custom-provider": {
          apiKey: "test-key",
          models: [
            {
              id: "my-model",
              api: "openai-completions",
              reasoning: false,
              input: ["text"],
            },
          ],
        },
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      expect(registry.getError()).toContain("baseUrl");
    
}),
));

    test("reports every provider composition error", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        "broken-one": { api: "openai-completions", models: [{ id: "one" }] },
        "broken-two": { api: "openai-completions", models: [{ id: "two" }] },
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const error = registry.getError();

      expect(error).toContain('Provider "broken-one"');
      expect(error).toContain('Provider "broken-two"');
    
}),
));

    test("custom provider with same name as built-in merges with built-in models", () => runTest(
Effect.gen(function* () {

      writeModelsJson({
        "anthropic-api": providerConfig("https://my-proxy.example.com/v1", [{ id: "claude-custom" }]),
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      expect(anthropicModels.length).toBeGreaterThan(1);
      expect(anthropicModels.some((m) => m.id === "claude-custom")).toBe(true);
      expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
    
}),
));

    test("custom model with same id replaces built-in model by id", () => runTest(
Effect.gen(function* () {

      writeModelsJson({
        openrouter: providerConfig(
          "https://my-proxy.example.com/v1",
          [{ id: "anthropic/claude-sonnet-4.5" }],
          "openai-completions",
        ),
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const models = getModelsForProvider(registry, "openrouter");
      const sonnetModels = models.filter((m) => m.id === "anthropic/claude-sonnet-4.5");

      expect(sonnetModels).toHaveLength(1);
      expect(sonnetModels[0]?.baseUrl).toBe("https://my-proxy.example.com/v1");
    
}),
));

    test("custom provider with same name as built-in does not affect other built-in providers", () => runTest(
Effect.gen(function* () {

      writeModelsJson({
        "anthropic-api": providerConfig("https://my-proxy.example.com/v1", [{ id: "claude-custom" }]),
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));

      expect(getModelsForProvider(registry, "opencode").length).toBeGreaterThan(0);
      expect(getModelsForProvider(registry, "openai").length).toBeGreaterThan(0);
    
}),
));

    test("provider-level baseUrl applies to both built-in and custom models", () => runTest(
Effect.gen(function* () {

      writeModelsJson({
        "anthropic-api": providerConfig("https://merged-proxy.example.com/v1", [{ id: "claude-custom" }]),
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      for (const model of anthropicModels) {
        expect(model.baseUrl).toBe("https://merged-proxy.example.com/v1");
      }
    
}),
));

    test("provider-level compat applies to custom models", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        demo: {
          baseUrl: "https://example.com/v1",
          apiKey: "DEMO_KEY",
          api: "openai-completions",
          compat: {
            supportsUsageInStreaming: false,
            maxTokensField: "max_tokens",
          },
          models: [
            {
              id: "demo-model",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1000,
              maxTokens: 100,
            },
          ],
        },
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const compat = registry.find("demo", "demo-model")?.compat as
        | OpenAICompletionsCompat
        | undefined;

      expect(compat?.supportsUsageInStreaming).toBe(false);
      expect(compat?.maxTokensField).toBe("max_tokens");
    
}),
));

    test("model-level compat overrides provider-level compat for custom models", () => runTest(
Effect.gen(function* () {

      writeRawModelsJson({
        demo: {
          baseUrl: "https://example.com/v1",
          apiKey: "DEMO_KEY",
          api: "openai-completions",
          compat: {
            supportsUsageInStreaming: false,
            maxTokensField: "max_tokens",
          },
          models: [
            {
              id: "demo-model",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 1000,
              maxTokens: 100,
              compat: {
                supportsUsageInStreaming: true,
                maxTokensField: "max_completion_tokens",
              },
            },
          ],
        },
      });

      const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
      const compat = registry.find("demo", "demo-model")?.compat as
        | OpenAICompletionsCompat
        | undefined;

      expect(compat?.supportsUsageInStreaming).toBe(true);
      expect(compat?.maxTokensField).toBe("max_completion_tokens");
    
}),
));
  });
});
