import type { AnthropicMessagesCompat, OpenAICompletionsCompat } from "@msa/ai/compat";
import {
  awaited,
  joinPath,
  makeTempDir,
  randomSuffixSync,
  removePath,
  runTest,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { clearApiKeyCache, type ModelRegistry } from "../src/core/model-registry.ts";
import { nodeFs } from "./model-registry-support.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";

describe("ModelRegistry", () => {
  let tempDir: string;

  let modelsJsonPath: string;

  let authStorage: AuthStorage;

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
    test("provider-level compat applies to built-in models", () =>
      runTest(
        Effect.gen(function* () {
          writeRawModelsJson({
            openrouter: {
              compat: {
                supportsUsageInStreaming: false,
                supportsStrictMode: false,
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");

          expect(models.length).toBeGreaterThan(0);
          for (const model of models) {
            const compat = model.compat as OpenAICompletionsCompat | undefined;
            expect(compat?.supportsUsageInStreaming).toBe(false);
            expect(compat?.supportsStrictMode).toBe(false);
          }
        }),
      ));

    test("model schema accepts thinkingLevelMap and compat schema accepts supportsStrictMode and cacheControlFormat", () =>
      runTest(
        Effect.gen(function* () {
          writeRawModelsJson({
            demo: {
              baseUrl: "https://example.com/v1",
              apiKey: "DEMO_KEY",
              api: "openai-completions",
              models: [
                {
                  id: "demo-model",
                  reasoning: true,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 1000,
                  maxTokens: 100,
                  thinkingLevelMap: {
                    minimal: null,
                    high: "max",
                  },
                  compat: {
                    supportsStrictMode: false,
                    cacheControlFormat: "anthropic",
                  },
                },
              ],
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const model = registry.find("demo", "demo-model");
          const compat = model?.compat as OpenAICompletionsCompat | undefined;

          expect(registry.getError()).toBeUndefined();
          expect(model?.thinkingLevelMap).toEqual({ minimal: null, high: "max" });
          expect(compat?.supportsStrictMode).toBe(false);
          expect(compat?.cacheControlFormat).toBe("anthropic");
        }),
      ));

    test("compat schema accepts chat template thinking configuration", () =>
      runTest(
        Effect.gen(function* () {
          writeRawModelsJson({
            demo: {
              baseUrl: "https://example.com/v1",
              apiKey: "DEMO_KEY",
              api: "openai-completions",
              models: [
                {
                  id: "kwargs-model",
                  reasoning: true,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 1000,
                  maxTokens: 100,
                  compat: {
                    thinkingFormat: "chat-template",
                    chatTemplateKwargs: {
                      preserve_thinking: true,
                      thinking: { $var: "thinking.enabled" },
                    },
                  },
                },
              ],
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const kwargsCompat = registry.find("demo", "kwargs-model")?.compat as
            | OpenAICompletionsCompat
            | undefined;

          expect(registry.getError()).toBeUndefined();
          expect(kwargsCompat?.thinkingFormat).toBe("chat-template");
          expect(kwargsCompat?.chatTemplateKwargs).toEqual({
            preserve_thinking: true,
            thinking: { $var: "thinking.enabled" },
          });
        }),
      ));

    test("compat schema accepts Anthropic eager tool input streaming flag", () =>
      runTest(
        Effect.gen(function* () {
          writeRawModelsJson({
            demo: {
              baseUrl: "https://example.com",
              apiKey: "DEMO_KEY",
              api: "anthropic-messages",
              compat: {
                supportsEagerToolInputStreaming: false,
              },
              models: [
                {
                  id: "demo-model",
                  reasoning: true,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 1000,
                  maxTokens: 100,
                },
              ],
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const compat = registry.find("demo", "demo-model")?.compat as
            | AnthropicMessagesCompat
            | undefined;

          expect(registry.getError()).toBeUndefined();
          expect(compat?.supportsEagerToolInputStreaming).toBe(false);
        }),
      ));

    test("compat schema accepts long cache retention flag", () =>
      runTest(
        Effect.gen(function* () {
          writeRawModelsJson({
            demo: {
              baseUrl: "https://example.com",
              apiKey: "DEMO_KEY",
              api: "anthropic-messages",
              compat: {
                supportsLongCacheRetention: false,
              },
              models: [
                {
                  id: "demo-model",
                  reasoning: true,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 1000,
                  maxTokens: 100,
                },
              ],
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const compat = registry.find("demo", "demo-model")?.compat as
            | AnthropicMessagesCompat
            | undefined;

          expect(registry.getError()).toBeUndefined();
          expect(compat?.supportsLongCacheRetention).toBe(false);
        }),
      ));
  });
});
