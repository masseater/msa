import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { type ModelRegistry, clearApiKeyCache } from "../src/core/model-registry.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeTempDir, randomSuffixSync, removePath, runTest, writeJsonFile } =
  testing;

let tempDir: string;

let modelsJsonPath: string;

let authStorage: AuthStorage;

function getModelsForProvider(registry: ModelRegistry, provider: string) {
  return registry.getAll().filter((m) => m.provider === provider);
}

const writeRawModelsJson = (providers: Record<string, unknown>) =>
  writeJsonFile(modelsJsonPath, { providers });

const providerLevelCompatAppliesToBuiltIn = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        openrouter: {
          compat: {
            supportsStrictMode: false,
            supportsUsageInStreaming: false,
          },
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const models = getModelsForProvider(registry, "openrouter");

      expect(models.length).toBeGreaterThan(0);
      for (const model of models) {
        const compat = model.compat as compatTypes.OpenAICompletionsCompat | undefined;
        expect(compat?.supportsUsageInStreaming).toBe(false);
        expect(compat?.supportsStrictMode).toBe(false);
      }
    }),
  );

const modelSchemaAcceptsThinkinglevelmapAndCompatSchema = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        demo: {
          api: "openai-completions",
          apiKey: "DEMO_KEY",
          baseUrl: "https://example.com/v1",
          models: [
            {
              compat: {
                cacheControlFormat: "anthropic",
                supportsStrictMode: false,
              },
              contextWindow: 1000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "demo-model",
              input: ["text"],
              maxTokens: 100,
              reasoning: true,
              thinkingLevelMap: {
                high: "max",
                minimal: null,
              },
            },
          ],
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const model = registry.find("demo", "demo-model");
      const compat = model?.compat as compatTypes.OpenAICompletionsCompat | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(model?.thinkingLevelMap).toEqual({ high: "max", minimal: null });
      expect(compat?.supportsStrictMode).toBe(false);
      expect(compat?.cacheControlFormat).toBe("anthropic");
    }),
  );

const compatSchemaAcceptsChatTemplateThinkingConfiguration = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        demo: {
          api: "openai-completions",
          apiKey: "DEMO_KEY",
          baseUrl: "https://example.com/v1",
          models: [
            {
              compat: {
                chatTemplateKwargs: {
                  preserve_thinking: true,
                  thinking: { $var: "thinking.enabled" },
                },
                thinkingFormat: "chat-template",
              },
              contextWindow: 1000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "kwargs-model",
              input: ["text"],
              maxTokens: 100,
              reasoning: true,
            },
          ],
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const kwargsCompat = registry.find("demo", "kwargs-model")?.compat as
        | compatTypes.OpenAICompletionsCompat
        | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(kwargsCompat?.thinkingFormat).toBe("chat-template");
      expect(kwargsCompat?.chatTemplateKwargs).toEqual({
        preserve_thinking: true,
        thinking: { $var: "thinking.enabled" },
      });
    }),
  );

const compatSchemaAcceptsAnthropicEagerToolInput = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        demo: {
          api: "anthropic-messages",
          apiKey: "DEMO_KEY",
          baseUrl: "https://example.com",
          compat: {
            supportsEagerToolInputStreaming: false,
          },
          models: [
            {
              contextWindow: 1000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "demo-model",
              input: ["text"],
              maxTokens: 100,
              reasoning: true,
            },
          ],
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const compat = registry.find("demo", "demo-model")?.compat as
        | compatTypes.AnthropicMessagesCompat
        | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(compat?.supportsEagerToolInputStreaming).toBe(false);
    }),
  );

const compatSchemaAcceptsLongCacheRetentionFlag = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        demo: {
          api: "anthropic-messages",
          apiKey: "DEMO_KEY",
          baseUrl: "https://example.com",
          compat: {
            supportsLongCacheRetention: false,
          },
          models: [
            {
              contextWindow: 1000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "demo-model",
              input: ["text"],
              maxTokens: 100,
              reasoning: true,
            },
          ],
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const compat = registry.find("demo", "demo-model")?.compat as
        | compatTypes.AnthropicMessagesCompat
        | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(compat?.supportsLongCacheRetention).toBe(false);
    }),
  );

const beforeEachHook = () =>
  runTest(makeTempDir(`msa-test-model-registry-${randomSuffixSync()}-`)).then((dir) => {
    tempDir = dir;
    modelsJsonPath = joinPath(tempDir, "models.json");
    authStorage = AuthStorage.inMemory();
    return dir;
  });

const afterEachHook = () => {
  clearApiKeyCache();
  vi.restoreAllMocks();
  return runTest(removePath(tempDir));
};

describe("ModelRegistry", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  describe("custom models merge behavior", () => {
    test("provider-level compat applies to built-in models", providerLevelCompatAppliesToBuiltIn);

    test(
      "model schema accepts thinkingLevelMap and compat schema accepts supportsStrictMode and cacheControlFormat",
      modelSchemaAcceptsThinkinglevelmapAndCompatSchema,
    );

    test(
      "compat schema accepts chat template thinking configuration",
      compatSchemaAcceptsChatTemplateThinkingConfiguration,
    );

    test(
      "compat schema accepts Anthropic eager tool input streaming flag",
      compatSchemaAcceptsAnthropicEagerToolInput,
    );

    test(
      "compat schema accepts long cache retention flag",
      compatSchemaAcceptsLongCacheRetentionFlag,
    );
  });
});
