import { createProvider, normalizeContext } from "@msa/ai";
import type { AnthropicMessagesCompat, Api, Model, OpenAICompletionsCompat } from "@msa/ai/compat";
import { getApiProvider, getSupportedThinkingLevels } from "@msa/ai/compat";
import {
  awaited,
  runTest,
  currentTimeMillis,
  deferredPromise,
  joinPath,
  makeTempDir,
  pathExists,
  readTextFile,
  removePath,
  toJsonText,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelConfig, type ModelsJsonProvider } from "../src/core/model-config.ts";
import {
  clearApiKeyCache,
  type ModelRegistry,
  type ProviderConfigInput,
} from "../src/core/model-registry.ts";
import { readEnv } from "../src/core/process-env.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";

describe("ModelRegistry", () => {
  let tempDir: string;
  let modelsJsonPath: string;
  let authStorage: AuthStorage;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = yield* makeTempDir("msa-test-model-registry-");
        modelsJsonPath = joinPath(tempDir, "models.json");
        authStorage = AuthStorage.inMemory();
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        if (tempDir.length > 0 && (yield* pathExists(tempDir))) {
          yield* removePath(tempDir);
        }
        clearApiKeyCache();
        vi.restoreAllMocks();
      }),
    ),
  );

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

  const writeModelsJson = (
    providers: Record<string, ReturnType<typeof providerConfig>>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* writeTextFile(modelsJsonPath, yield* toJsonText({ providers }));
    });

  function getModelsForProvider(registry: ModelRegistry, provider: string) {
    return registry.getAll().filter((m) => m.provider === provider);
  }

  function toShPath(value: string): string {
    return value.replace(/\\/gu, "/").replace(/"/gu, '\\"');
  }

  function overrideConfig(baseUrl: string, headers?: Record<string, string>) {
    return { baseUrl, ...(headers && { headers }) };
  }

  const writeRawModelsJson = (providers: Record<string, unknown>): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* writeTextFile(modelsJsonPath, yield* toJsonText({ providers }));
    });

  const openAiModel: Model<Api> = {
    id: "test-openai-model",
    name: "Test OpenAI Model",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };

  const emptyContext = normalizeContext({
    messages: [],
  });

  describe("baseUrl override (no custom models)", () => {
    test("overriding baseUrl keeps all built-in models", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            anthropic: overrideConfig("https://my-proxy.example.com/v1"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const anthropicModels = getModelsForProvider(registry, "anthropic");

          expect(anthropicModels.length).toBeGreaterThan(1);
          expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
        }),
      ));

    test("overriding baseUrl changes URL on all built-in models", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            anthropic: overrideConfig("https://my-proxy.example.com/v1"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const anthropicModels = getModelsForProvider(registry, "anthropic");

          for (const model of anthropicModels) {
            expect(model.baseUrl).toBe("https://my-proxy.example.com/v1");
          }
        }),
      ));

    test("overriding headers resolves at request time", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            anthropic: overrideConfig("https://my-proxy.example.com/v1", {
              "X-Custom-Header": "custom-value",
            }),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const anthropicModels = getModelsForProvider(registry, "anthropic");

          for (const model of anthropicModels) {
            const auth = yield* awaited(registry.getApiKeyAndHeaders(model));
            expect(auth.ok).toBe(true);
            if (auth.ok) {
              expect(auth.headers?.["X-Custom-Header"]).toBe("custom-value");
            }
          }
        }),
      ));

    test("headers-only override resolves at request time", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            anthropic: {
              headers: {
                "X-Custom-Header": "custom-value",
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          expect(registry.getError()).toBeUndefined();
          const anthropicModels = getModelsForProvider(registry, "anthropic");

          for (const model of anthropicModels) {
            const auth = yield* awaited(registry.getApiKeyAndHeaders(model));
            expect(auth.ok).toBe(true);
            if (auth.ok) {
              expect(auth.headers?.["X-Custom-Header"]).toBe("custom-value");
            }
          }
        }),
      ));

    test("unconfigured compatibility auth includes static model headers", () =>
      runTest(
        Effect.gen(function* () {
          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const base = registry.getAll()[0];
          if (base === undefined) throw new Error("expected a registered model");
          const model = {
            ...base,
            provider: "missing-provider",
            headers: { "X-Static-Model": "static-value" },
          };

          const auth = yield* awaited(registry.getApiKeyAndHeaders(model));

          expect(auth).toEqual({ ok: true, headers: { "X-Static-Model": "static-value" } });
        }),
      ));

    test("baseUrl-only override does not affect other providers", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            anthropic: overrideConfig("https://my-proxy.example.com/v1"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const opencodeModels = getModelsForProvider(registry, "opencode");

          expect(opencodeModels.length).toBeGreaterThan(0);
          expect(opencodeModels[0]?.baseUrl).not.toBe("https://my-proxy.example.com/v1");
        }),
      ));

    test("can mix baseUrl override and models merge", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            anthropic: overrideConfig("https://anthropic-proxy.example.com/v1"),

            opencode: providerConfig(
              "https://opencode-proxy.example.com/v1",
              [{ id: "gemini-custom" }],
              "google-generative-ai",
            ),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

          const anthropicModels = getModelsForProvider(registry, "anthropic");
          expect(anthropicModels.length).toBeGreaterThan(1);
          expect(anthropicModels[0]?.baseUrl).toBe("https://anthropic-proxy.example.com/v1");

          const opencodeModels = getModelsForProvider(registry, "opencode");
          expect(opencodeModels.length).toBeGreaterThan(1);
          expect(opencodeModels.some((m) => m.id === "gemini-custom")).toBe(true);
        }),
      ));

    test("refresh() picks up baseUrl override changes", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            anthropic: overrideConfig("https://first-proxy.example.com/v1"),
          });
          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

          expect(getModelsForProvider(registry, "anthropic")[0]?.baseUrl).toBe(
            "https://first-proxy.example.com/v1",
          );

          yield* writeRawModelsJson({
            anthropic: overrideConfig("https://second-proxy.example.com/v1"),
          });
          yield* awaited(registry.refresh());

          expect(getModelsForProvider(registry, "anthropic")[0]?.baseUrl).toBe(
            "https://second-proxy.example.com/v1",
          );
        }),
      ));
  });

  describe("custom models merge behavior", () => {
    test("built-in provider custom models inherit api and baseUrl without explicit fields", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
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

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          expect(registry.getError()).toBeUndefined();

          const model = registry.find("openrouter", "fake-provider/fake-model");
          expect(model).toBeDefined();
          expect(model?.api).toBe("openai-completions");
          expect(model?.baseUrl).toBe("https://openrouter.ai/api/v1");
        }),
      ));

    test("non-built-in provider custom models still require baseUrl", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
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

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          expect(registry.getError()).toContain("baseUrl");
        }),
      ));

    test("reports every provider composition error", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            "broken-one": { api: "openai-completions", models: [{ id: "one" }] },
            "broken-two": { api: "openai-completions", models: [{ id: "two" }] },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const error = registry.getError();

          expect(error).toContain('Provider "broken-one"');
          expect(error).toContain('Provider "broken-two"');
        }),
      ));

    test("custom provider with same name as built-in merges with built-in models", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeModelsJson({
            anthropic: providerConfig("https://my-proxy.example.com/v1", [{ id: "claude-custom" }]),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const anthropicModels = getModelsForProvider(registry, "anthropic");

          expect(anthropicModels.length).toBeGreaterThan(1);
          expect(anthropicModels.some((m) => m.id === "claude-custom")).toBe(true);
          expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
        }),
      ));

    test("custom model with same id replaces built-in model by id", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeModelsJson({
            openrouter: providerConfig(
              "https://my-proxy.example.com/v1",
              [{ id: "anthropic/claude-sonnet-4.5" }],
              "openai-completions",
            ),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");
          const sonnetModels = models.filter((m) => m.id === "anthropic/claude-sonnet-4.5");

          expect(sonnetModels).toHaveLength(1);
          expect(sonnetModels[0]?.baseUrl).toBe("https://my-proxy.example.com/v1");
        }),
      ));

    test("custom provider with same name as built-in does not affect other built-in providers", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeModelsJson({
            anthropic: providerConfig("https://my-proxy.example.com/v1", [{ id: "claude-custom" }]),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

          expect(getModelsForProvider(registry, "opencode").length).toBeGreaterThan(0);
          expect(getModelsForProvider(registry, "openai").length).toBeGreaterThan(0);
        }),
      ));

    test("provider-level baseUrl applies to both built-in and custom models", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeModelsJson({
            anthropic: providerConfig("https://merged-proxy.example.com/v1", [
              { id: "claude-custom" },
            ]),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const anthropicModels = getModelsForProvider(registry, "anthropic");

          for (const model of anthropicModels) {
            expect(model.baseUrl).toBe("https://merged-proxy.example.com/v1");
          }
        }),
      ));

    test("provider-level compat applies to custom models", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
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

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const compat = registry.find("demo", "demo-model")?.compat as
            | OpenAICompletionsCompat
            | undefined;

          expect(compat?.supportsUsageInStreaming).toBe(false);
          expect(compat?.maxTokensField).toBe("max_tokens");
        }),
      ));

    test("model-level compat overrides provider-level compat for custom models", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
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

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const compat = registry.find("demo", "demo-model")?.compat as
            | OpenAICompletionsCompat
            | undefined;

          expect(compat?.supportsUsageInStreaming).toBe(true);
          expect(compat?.maxTokensField).toBe("max_completion_tokens");
        }),
      ));

    test("provider-level compat applies to built-in models", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
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
          yield* writeRawModelsJson({
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
          yield* writeRawModelsJson({
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
          yield* writeRawModelsJson({
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
          yield* writeRawModelsJson({
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

    test("model-level baseUrl overrides provider-level baseUrl for custom models", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
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

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const m25 = registry.find("opencode-go", "minimax-m2.5");
          const glm5 = registry.find("opencode-go", "glm-5");

          expect(m25?.baseUrl).toBe("https://opencode.ai/zen/go");
          expect(glm5?.baseUrl).toBe("https://opencode.ai/zen/go/v1");
        }),
      ));

    test("modelOverrides still apply when provider also defines models", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
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

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");

          expect(models.some((m) => m.id === "custom/openrouter-model")).toBe(true);
          expect(
            models.some(
              (m) =>
                m.id === "anthropic/claude-sonnet-4.5" && m.name === "Overridden Built-in Sonnet",
            ),
          ).toBe(true);
        }),
      ));

    test("refresh() reloads merged custom models from disk", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeModelsJson({
            anthropic: providerConfig("https://first-proxy.example.com/v1", [
              { id: "claude-custom" },
            ]),
          });
          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          expect(
            getModelsForProvider(registry, "anthropic").some((m) => m.id === "claude-custom"),
          ).toBe(true);

          yield* writeModelsJson({
            anthropic: providerConfig("https://second-proxy.example.com/v1", [
              { id: "claude-custom-2" },
            ]),
          });
          yield* awaited(registry.refresh());

          const anthropicModels = getModelsForProvider(registry, "anthropic");
          expect(anthropicModels.some((m) => m.id === "claude-custom")).toBe(false);
          expect(anthropicModels.some((m) => m.id === "claude-custom-2")).toBe(true);
          expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
        }),
      ));

    test("removing custom models from models.json keeps built-in provider models", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeModelsJson({
            anthropic: providerConfig("https://proxy.example.com/v1", [{ id: "claude-custom" }]),
          });
          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          expect(
            getModelsForProvider(registry, "anthropic").some((m) => m.id === "claude-custom"),
          ).toBe(true);

          yield* writeModelsJson({});
          yield* awaited(registry.refresh());

          const anthropicModels = getModelsForProvider(registry, "anthropic");
          expect(anthropicModels.some((m) => m.id === "claude-custom")).toBe(false);
          expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
        }),
      ));
  });

  describe("modelOverrides (per-model customization)", () => {
    test("model override applies to a single built-in model", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            openrouter: {
              modelOverrides: {
                "anthropic/claude-sonnet-4.5": {
                  name: "Custom Sonnet Name",
                },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");

          const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
          expect(sonnet?.name).toBe("Custom Sonnet Name");

          const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");
          expect(opus?.name).not.toBe("Custom Sonnet Name");
        }),
      ));

    test("Anthropic model override replaces allowed fallback metadata", () =>
      runTest(
        Effect.gen(function* () {
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
          yield* writeRawModelsJson({
            anthropic: {
              modelOverrides: {
                "claude-fable-5": {
                  compat: { allowedFallbackModels },
                },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const compat = registry.find("anthropic", "claude-fable-5")?.compat as
            | AnthropicMessagesCompat
            | undefined;

          expect(registry.getError()).toBeUndefined();
          expect(compat?.allowedFallbackModels).toEqual(allowedFallbackModels);
        }),
      ));

    test("empty allowed fallback model override disables server-side fallback", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            anthropic: {
              modelOverrides: {
                "claude-fable-5": { compat: { allowedFallbackModels: [] } },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const compat = registry.find("anthropic", "claude-fable-5")?.compat as
            | AnthropicMessagesCompat
            | undefined;

          expect(registry.getError()).toBeUndefined();
          expect(compat?.allowedFallbackModels).toEqual([]);
        }),
      ));

    test("custom models and model overrides carry sampling params", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            openrouter: {
              baseUrl: "https://my-proxy.example.com/v1",
              api: "openai-completions",
              models: [
                {
                  id: "custom/sampling-model",
                  samplingParams: { temperature: 1, top_p: 0.95, top_k: 0 },
                  samplingParamsByThinkingLevel: {
                    low: { temperature: 0.6, top_p: 0.95 },
                    high: { temperature: 0.8 },
                  },
                },
              ],
              modelOverrides: {
                "custom/sampling-model": {
                  samplingParamsByThinkingLevel: {
                    low: { temperature: 0.5, top_k: 20 },
                    max: { temperature: 1 },
                  },
                },
                "anthropic/claude-sonnet-4.5": {
                  samplingParams: { top_p: 0.9 },
                  samplingParamsByThinkingLevel: { high: { temperature: 0.8 } },
                },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");

          const custom = models.find((m) => m.id === "custom/sampling-model");
          expect(custom?.samplingParams).toEqual({ temperature: 1, top_p: 0.95, top_k: 0 });
          expect(custom?.samplingParamsByThinkingLevel).toEqual({
            low: { temperature: 0.5, top_p: 0.95, top_k: 20 },
            high: { temperature: 0.8 },
            max: { temperature: 1 },
          });

          const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
          expect(sonnet?.samplingParams).toEqual({ top_p: 0.9 });
          expect(sonnet?.samplingParamsByThinkingLevel).toEqual({ high: { temperature: 0.8 } });

          const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");
          expect(opus?.samplingParams).toBeUndefined();
          expect(opus?.samplingParamsByThinkingLevel).toBeUndefined();
        }),
      ));

    test("custom model and model override carry prompt cache lifetimes", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            openrouter: {
              baseUrl: "https://my-proxy.example.com/v1",
              api: "openai-completions",
              models: [{ id: "custom/cached-model", promptCache: { short: 120 } }],
              modelOverrides: {
                "anthropic/claude-sonnet-4.5": { promptCache: { short: 300 } },
              },
            },
            anthropic: {
              modelOverrides: {
                "claude-sonnet-4-6": { promptCache: { long: 1800 } },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const openrouter = getModelsForProvider(registry, "openrouter");

          expect(registry.getError()).toBeUndefined();
          expect(openrouter.find((m) => m.id === "custom/cached-model")?.promptCache).toEqual({
            short: 120,
          });
          expect(
            openrouter.find((m) => m.id === "anthropic/claude-sonnet-4.5")?.promptCache,
          ).toEqual({
            short: 300,
          });
          expect(
            openrouter.find((m) => m.id === "anthropic/claude-opus-4.1")?.promptCache,
          ).toBeUndefined();

          expect(registry.find("anthropic", "claude-sonnet-4-6")?.promptCache).toEqual({
            short: 300,
            long: 1800,
          });
        }),
      ));

    test("model override deep-merges image resize limits", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            test: {
              baseUrl: "https://example.com",
              apiKey: "test-key",
              api: "openai-completions",
              models: [
                {
                  id: "vision-model",
                  input: ["text", "image"],
                  inputLimits: {
                    maxRequestBytes: 32 * 1024 * 1024,
                    images: {
                      maxPerRequest: 100,
                      resize: {
                        maxWidth: 2000,
                        maxHeight: 2000,
                        maxBytes: 4.5 * 1024 * 1024,
                        jpegQuality: 80,
                      },
                    },
                  },
                },
              ],
              modelOverrides: {
                "vision-model": {
                  inputLimits: {
                    images: { resize: { maxWidth: 1568, maxBytes: 524288, jpegQuality: 75 } },
                  },
                },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const model = registry.find("test", "vision-model");

          expect(registry.getError()).toBeUndefined();
          expect(model?.inputLimits).toMatchObject({
            maxRequestBytes: 32 * 1024 * 1024,
            images: {
              maxPerRequest: 100,
              resize: { maxWidth: 1568, maxHeight: 2000, maxBytes: 524288, jpegQuality: 75 },
            },
          });
        }),
      ));

    test("model override with compat.openRouterRouting", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
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

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");

          const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
          const compat = sonnet?.compat as OpenAICompletionsCompat | undefined;
          expect(compat?.openRouterRouting).toEqual({ only: ["amazon-bedrock"] });
        }),
      ));

    test("supportsFinishReason can be configured at provider and model levels", () =>
      runTest(
        Effect.gen(function* () {
          const provider: ModelsJsonProvider = {
            compat: { supportsFinishReason: true },
            modelOverrides: {
              "anthropic/claude-sonnet-4.5": {
                compat: { supportsFinishReason: false },
              },
            },
          };
          yield* writeRawModelsJson({ openrouter: provider });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");
          const sonnet = models.find((model) => model.id === "anthropic/claude-sonnet-4.5");
          const opus = models.find((model) => model.id === "anthropic/claude-opus-4.1");

          expect(
            (sonnet?.compat as OpenAICompletionsCompat | undefined)?.supportsFinishReason,
          ).toBe(false);
          expect((opus?.compat as OpenAICompletionsCompat | undefined)?.supportsFinishReason).toBe(
            true,
          );
        }),
      ));

    test("model override deep merges compat settings", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
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

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");
          const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

          const compat = sonnet?.compat as OpenAICompletionsCompat | undefined;
          expect(compat?.openRouterRouting).toEqual({ order: ["anthropic", "together"] });
        }),
      ));

    test("multiple model overrides on same provider", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
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

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");

          const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
          const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");

          const sonnetCompat = sonnet?.compat as OpenAICompletionsCompat | undefined;
          const opusCompat = opus?.compat as OpenAICompletionsCompat | undefined;
          expect(sonnetCompat?.openRouterRouting).toEqual({ only: ["amazon-bedrock"] });
          expect(opusCompat?.openRouterRouting).toEqual({ only: ["anthropic"] });
        }),
      ));

    test("model override combined with baseUrl override", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            openrouter: {
              baseUrl: "https://my-proxy.example.com/v1",
              modelOverrides: {
                "anthropic/claude-sonnet-4.5": {
                  name: "Proxied Sonnet",
                },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");
          const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

          expect(sonnet?.baseUrl).toBe("https://my-proxy.example.com/v1");
          expect(sonnet?.name).toBe("Proxied Sonnet");

          const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");
          expect(opus?.baseUrl).toBe("https://my-proxy.example.com/v1");
          expect(opus?.name).not.toBe("Proxied Sonnet");
        }),
      ));

    test("model override for non-existent model ID is ignored", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            openrouter: {
              modelOverrides: {
                "nonexistent/model-id": {
                  name: "This should not appear",
                },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");

          expect(models.find((m) => m.id === "nonexistent/model-id")).toBeUndefined();

          expect(registry.getError()).toBeUndefined();
        }),
      ));

    test("model override can change cost fields partially", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            openrouter: {
              modelOverrides: {
                "anthropic/claude-sonnet-4.5": {
                  cost: { input: 99 },
                },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");
          const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

          expect(sonnet?.cost.input).toBe(99);

          expect(sonnet?.cost.output).toBeGreaterThan(0);
        }),
      ));

    test("model override can add headers at request time", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            openrouter: {
              modelOverrides: {
                "anthropic/claude-sonnet-4.5": {
                  headers: { "X-Custom-Model-Header": "value" },
                },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");
          const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
          expect(sonnet).toBeDefined();

          const auth = yield* awaited(registry.getApiKeyAndHeaders(sonnet!));
          expect(auth.ok).toBe(true);
          if (auth.ok) {
            expect(auth.headers?.["X-Custom-Model-Header"]).toBe("value");
          }
        }),
      ));

    test("refresh() picks up model override changes", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            openrouter: {
              modelOverrides: {
                "anthropic/claude-sonnet-4.5": {
                  name: "First Name",
                },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          expect(
            getModelsForProvider(registry, "openrouter").find(
              (m) => m.id === "anthropic/claude-sonnet-4.5",
            )?.name,
          ).toBe("First Name");

          yield* writeRawModelsJson({
            openrouter: {
              modelOverrides: {
                "anthropic/claude-sonnet-4.5": {
                  name: "Second Name",
                },
              },
            },
          });
          yield* awaited(registry.refresh());

          expect(
            getModelsForProvider(registry, "openrouter").find(
              (m) => m.id === "anthropic/claude-sonnet-4.5",
            )?.name,
          ).toBe("Second Name");
        }),
      ));

    test("removing model override restores built-in values", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            openrouter: {
              modelOverrides: {
                "anthropic/claude-sonnet-4.5": {
                  name: "Custom Name",
                },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const customName = getModelsForProvider(registry, "openrouter").find(
            (m) => m.id === "anthropic/claude-sonnet-4.5",
          )?.name;
          expect(customName).toBe("Custom Name");

          yield* writeRawModelsJson({});
          yield* awaited(registry.refresh());

          const restoredName = getModelsForProvider(registry, "openrouter").find(
            (m) => m.id === "anthropic/claude-sonnet-4.5",
          )?.name;
          expect(restoredName).not.toBe("Custom Name");
        }),
      ));
  });

  describe("dynamic provider lifecycle", () => {
    test("getProviderDisplayName resolves registered, OAuth, built-in, and fallback names", () =>
      runTest(
        Effect.gen(function* () {
          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

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
              login: () =>
                runTest(
                  Effect.sync(() => ({
                    access: "access",
                    refresh: "refresh",
                    expires: currentTimeMillis() + 60_000,
                  })),
                ),
              refreshToken: (credentials) => runTest(Effect.sync(() => credentials)),
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
        }),
      ));

    test("modelOverrides apply to dynamically registered provider models", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
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

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
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
          if (model === undefined) {
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
          expect(yield* awaited(registry.getApiKeyAndHeaders(model))).toMatchObject({
            ok: true,
            headers: { "x-model-override": "enabled" },
          });
        }),
      ));

    test("stored API key env propagates to request auth and resolves headers", () =>
      runTest(
        Effect.gen(function* () {
          yield* awaited(
            authStorage.modify("openrouter", () =>
              runTest(
                Effect.sync(() => ({
                  type: "api_key",
                  key: "stored-openrouter-key",
                  env: { OPENROUTER_TEAM: "stored-team" },
                })),
              ),
            ),
          );
          yield* writeRawModelsJson({
            openrouter: {
              headers: { "x-team": "$OPENROUTER_TEAM" },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const model = registry.getAll().find((m) => m.provider === "openrouter");
          expect(model).toBeDefined();

          const auth = yield* awaited(registry.getApiKeyAndHeaders(model!));

          expect(auth).toEqual({
            ok: true,
            apiKey: "stored-openrouter-key",
            headers: { "x-team": "stored-team" },
            env: { OPENROUTER_TEAM: "stored-team" },
          });
        }),
      ));

    test("registerProvider treats uppercase apiKey and headers as literals", () =>
      runTest(
        Effect.gen(function* () {
          const envKeys = ["CUSTOM_NAME", "BEARER", "MODEL_TOKEN"];
          const savedEnv: Record<string, string | undefined> = {};
          for (const key of envKeys) {
            savedEnv[key] = readEnv(key);
            vi.stubEnv(key, `env-${key}`);
          }
          const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

          try {
            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

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

            expect(yield* awaited(registry.getApiKeyForProvider("literal-provider"))).toBe(
              "CUSTOM_NAME",
            );
            const model = registry.find("literal-provider", "demo-model");
            expect(model).toBeDefined();
            expect(yield* awaited(registry.getApiKeyAndHeaders(model!))).toMatchObject({
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
                vi.stubEnv(key, undefined);
              } else {
                vi.stubEnv(key, savedEnv[key]);
              }
            }
          }
        }),
      ));

    test("failed registerProvider does not persist invalid streamSimple config", () =>
      runTest(
        Effect.gen(function* () {
          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

          expect(() =>
            registry.registerProvider("broken-provider", {
              streamSimple: (() => {
                throw new Error("should not run");
              }) as any,
            }),
          ).toThrow('Provider broken-provider: "api" is required when registering streamSimple.');

          yield* awaited(expect(registry.refresh()).resolves.toMatchObject({ aborted: false }));
        }),
      ));

    test("failed registerProvider does not remove existing provider models", () =>
      runTest(
        Effect.gen(function* () {
          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

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
          yield* awaited(expect(registry.refresh()).resolves.toMatchObject({ aborted: false }));
          expect(registry.find("demo-provider", "demo-model")).toBeDefined();
        }),
      ));

    const streamSimpleThrowsCustomOverride = (): boolean => {
      try {
        getApiProvider("openai-completions")?.streamSimple(openAiModel, emptyContext);
        return false;
      } catch (error) {
        return error instanceof Error && error.message === "custom streamSimple override";
      }
    };

    test("unregisterProvider removes the runtime OAuth overlay without mutating global state", () =>
      runTest(
        Effect.gen(function* () {
          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

          registry.registerProvider("anthropic", {
            oauth: {
              name: "Custom Anthropic OAuth",
              login: () =>
                runTest(
                  Effect.sync(() => ({
                    access: "custom-access-token",
                    refresh: "custom-refresh-token",
                    expires: currentTimeMillis() + 60_000,
                  })),
                ),
              refreshToken: (credentials) => runTest(Effect.sync(() => credentials)),
              getApiKey: (credentials) => credentials.access,
            },
          });

          expect(registry.getRegisteredProviderConfig("anthropic")?.oauth?.name).toBe(
            "Custom Anthropic OAuth",
          );

          registry.unregisterProvider("anthropic");

          expect(registry.getRegisteredProviderConfig("anthropic")).toBeUndefined();
        }),
      ));

    test("streamSimple overlays do not mutate the global compat API registry", () =>
      runTest(
        Effect.gen(function* () {
          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

          registry.registerProvider("stream-override-provider", {
            api: "openai-completions",
            streamSimple: () => {
              throw new Error("custom streamSimple override");
            },
          });

          expect(streamSimpleThrowsCustomOverride()).toBe(false);

          registry.unregisterProvider("stream-override-provider");

          expect(streamSimpleThrowsCustomOverride()).toBe(false);
        }),
      ));

    describe("dynamic provider override persistence", () => {
      test("baseUrl-only override keeps built-in provider models after refresh", () =>
        runTest(
          Effect.gen(function* () {
            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            registry.registerProvider("anthropic", { baseUrl: "https://proxy.test/anthropic" });
            yield* awaited(registry.refresh());

            const anthropicModels = getModelsForProvider(registry, "anthropic");
            expect(anthropicModels.length).toBeGreaterThan(1);
            expect(anthropicModels.every((m) => m.baseUrl === "https://proxy.test/anthropic")).toBe(
              true,
            );
          }),
        ));

      test("models-only override replaces built-in provider models after refresh", () =>
        runTest(
          Effect.gen(function* () {
            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            registry.registerProvider("anthropic", {
              ...providerConfig(
                "https://custom.test/anthropic",
                [{ id: "custom-claude" }],
                "anthropic-messages",
              ),
              baseUrl: "https://custom.test/anthropic",
            });
            yield* awaited(registry.refresh());

            expect(getModelsForProvider(registry, "anthropic").map((m) => m.id)).toEqual([
              "custom-claude",
            ]);
            expect(registry.find("anthropic", "custom-claude")?.baseUrl).toBe(
              "https://custom.test/anthropic",
            );
          }),
        ));

      test("models plus baseUrl override replaces built-in provider models after refresh", () =>
        runTest(
          Effect.gen(function* () {
            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            registry.registerProvider("anthropic", {
              ...providerConfig(
                "https://custom.test/anthropic",
                [{ id: "custom-claude" }],
                "anthropic-messages",
              ),
              baseUrl: "https://custom.test/anthropic",
            });
            registry.registerProvider("anthropic", { baseUrl: "https://proxy.test/anthropic" });
            yield* awaited(registry.refresh());

            expect(getModelsForProvider(registry, "anthropic").map((m) => m.id)).toEqual([
              "custom-claude",
            ]);
            expect(registry.find("anthropic", "custom-claude")?.baseUrl).toBe(
              "https://proxy.test/anthropic",
            );
          }),
        ));

      test("models-only custom provider registration survives refresh", () =>
        runTest(
          Effect.gen(function* () {
            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            registry.registerProvider(
              "custom-provider",
              providerConfig(
                "https://custom.test/v1",
                [{ id: "custom-a" }, { id: "custom-b" }],
                "openai-completions",
              ),
            );
            yield* awaited(registry.refresh());

            expect(getModelsForProvider(registry, "custom-provider").map((m) => m.id)).toEqual([
              "custom-a",
              "custom-b",
            ]);
          }),
        ));

      test("baseUrl-only override keeps custom provider models after refresh", () =>
        runTest(
          Effect.gen(function* () {
            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            registry.registerProvider(
              "custom-provider",
              providerConfig(
                "https://custom.test/v1",
                [{ id: "custom-a" }, { id: "custom-b" }],
                "openai-completions",
              ),
            );
            registry.registerProvider("custom-provider", { baseUrl: "https://proxy.test/custom" });
            yield* awaited(registry.refresh());

            expect(getModelsForProvider(registry, "custom-provider").map((m) => m.id)).toEqual([
              "custom-a",
              "custom-b",
            ]);
            expect(
              getModelsForProvider(registry, "custom-provider").every(
                (m) => m.baseUrl === "https://proxy.test/custom",
              ),
            ).toBe(true);
          }),
        ));

      test("headers-only override keeps custom provider models after refresh", () =>
        runTest(
          Effect.gen(function* () {
            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            registry.registerProvider(
              "custom-provider",
              providerConfig(
                "https://custom.test/v1",
                [{ id: "custom-a" }, { id: "custom-b" }],
                "openai-completions",
              ),
            );
            registry.registerProvider("custom-provider", { headers: { "x-proxy": "enabled" } });
            yield* awaited(registry.refresh());

            const models = getModelsForProvider(registry, "custom-provider");
            expect(models.map((m) => m.id)).toEqual(["custom-a", "custom-b"]);
            expect(models.every((m) => m.baseUrl === "https://custom.test/v1")).toBe(true);
            const [first] = models;
            if (first === undefined) throw new Error("expected custom-provider models");
            expect(yield* awaited(registry.getApiKeyAndHeaders(first))).toMatchObject({
              ok: true,
              headers: { "x-proxy": "enabled" },
            });
          }),
        ));
    });
  });

  describe("API key resolution", () => {
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

    test("apiKey with ! prefix executes command and uses stdout", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            "custom-provider": providerWithApiKey("!echo test-api-key-from-command"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

          expect(apiKey).toBe("test-api-key-from-command");
        }),
      ));

    test("apiKey with ! prefix trims whitespace from command output", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            "custom-provider": providerWithApiKey("!echo '  spaced-key  '"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

          expect(apiKey).toBe("spaced-key");
        }),
      ));

    test("apiKey with ! prefix handles multiline output (uses trimmed result)", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            "custom-provider": providerWithApiKey("!printf 'line1\\nline2'"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

          expect(apiKey).toBe("line1\nline2");
        }),
      ));

    test("apiKey with ! prefix returns undefined on command failure", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            "custom-provider": providerWithApiKey("!exit 1"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

          expect(apiKey).toBeUndefined();
        }),
      ));

    test("apiKey with ! prefix returns undefined on nonexistent command", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            "custom-provider": providerWithApiKey("!nonexistent-command-12345"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

          expect(apiKey).toBeUndefined();
        }),
      ));

    test("apiKey with ! prefix returns undefined on empty output", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            "custom-provider": providerWithApiKey("!printf ''"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

          expect(apiKey).toBeUndefined();
        }),
      ));

    test("apiKey with $ prefix resolves to env value", () =>
      runTest(
        Effect.gen(function* () {
          const originalEnv = readEnv("TEST_API_KEY_12345");
          vi.stubEnv("TEST_API_KEY_12345", "env-api-key-value");

          try {
            yield* writeRawModelsJson({
              "custom-provider": providerWithApiKey("$TEST_API_KEY_12345"),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

            expect(apiKey).toBe("env-api-key-value");
          } finally {
            if (originalEnv === undefined) {
              vi.stubEnv("TEST_API_KEY_12345", undefined);
            } else {
              vi.stubEnv("TEST_API_KEY_12345", originalEnv);
            }
          }
        }),
      ));

    test("apiKey with braced env syntax resolves to env value", () =>
      runTest(
        Effect.gen(function* () {
          const originalEnv = readEnv("TEST_BRACED_API_KEY_12345");
          vi.stubEnv("TEST_BRACED_API_KEY_12345", "braced-env-api-key-value");
          const bracedKey = "${TEST_BRACED_API_KEY_12345}";

          try {
            yield* writeRawModelsJson({
              "custom-provider": providerWithApiKey(bracedKey),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

            expect(apiKey).toBe("braced-env-api-key-value");
          } finally {
            if (originalEnv === undefined) {
              vi.stubEnv("TEST_BRACED_API_KEY_12345", undefined);
            } else {
              vi.stubEnv("TEST_BRACED_API_KEY_12345", originalEnv);
            }
          }
        }),
      ));

    test("apiKey interpolates braced env references inside literals", () =>
      runTest(
        Effect.gen(function* () {
          const originalPartA = readEnv("TEST_INTERPOLATED_PART_A_12345");
          const originalPartB = readEnv("TEST_INTERPOLATED_PART_B_12345");
          vi.stubEnv("TEST_INTERPOLATED_PART_A_12345", "left");
          vi.stubEnv("TEST_INTERPOLATED_PART_B_12345", "right");
          const interpolatedKey = [
            "$",
            "{TEST_INTERPOLATED_PART_A_12345}_$",
            "{TEST_INTERPOLATED_PART_B_12345}",
          ].join("");

          try {
            yield* writeRawModelsJson({
              "custom-provider": providerWithApiKey(interpolatedKey),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

            expect(apiKey).toBe("left_right");
          } finally {
            if (originalPartA === undefined) {
              vi.stubEnv("TEST_INTERPOLATED_PART_A_12345", undefined);
            } else {
              vi.stubEnv("TEST_INTERPOLATED_PART_A_12345", originalPartA);
            }
            if (originalPartB === undefined) {
              vi.stubEnv("TEST_INTERPOLATED_PART_B_12345", undefined);
            } else {
              vi.stubEnv("TEST_INTERPOLATED_PART_B_12345", originalPartB);
            }
          }
        }),
      ));

    test("apiKey with $$ prefix escapes a leading dollar", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            "custom-provider": providerWithApiKey("$$TEST_API_KEY_12345"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

          expect(apiKey).toBe("$TEST_API_KEY_12345");
        }),
      ));

    test("apiKey with $! escapes a literal bang and still interpolates later env refs", () =>
      runTest(
        Effect.gen(function* () {
          const originalEnv = readEnv("TEST_API_KEY_12345");
          vi.stubEnv("TEST_API_KEY_12345", "env-api-key-value");

          try {
            yield* writeRawModelsJson({
              "custom-provider": providerWithApiKey("$!literal-$TEST_API_KEY_12345"),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

            expect(apiKey).toBe("!literal-env-api-key-value");
          } finally {
            if (originalEnv === undefined) {
              vi.stubEnv("TEST_API_KEY_12345", undefined);
            } else {
              vi.stubEnv("TEST_API_KEY_12345", originalEnv);
            }
          }
        }),
      ));

    test("plain apiKey is used directly even when it matches an env var", () =>
      runTest(
        Effect.gen(function* () {
          const originalEnv = readEnv("TEST_API_KEY_12345");
          vi.stubEnv("TEST_API_KEY_12345", "env-api-key-value");

          try {
            yield* writeRawModelsJson({
              "custom-provider": providerWithApiKey("TEST_API_KEY_12345"),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

            expect(apiKey).toBe("TEST_API_KEY_12345");
          } finally {
            if (originalEnv === undefined) {
              vi.stubEnv("TEST_API_KEY_12345", undefined);
            } else {
              vi.stubEnv("TEST_API_KEY_12345", originalEnv);
            }
          }
        }),
      ));

    test("apiKey as literal value is used directly when not an env var", () =>
      runTest(
        Effect.gen(function* () {
          vi.stubEnv("literal_api_key_value", undefined);

          yield* writeRawModelsJson({
            "custom-provider": providerWithApiKey("literal_api_key_value"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

          expect(apiKey).toBe("literal_api_key_value");
        }),
      ));

    test("apiKey command can use shell features like pipes", () =>
      runTest(
        Effect.gen(function* () {
          yield* writeRawModelsJson({
            "custom-provider": providerWithApiKey("!echo 'hello world' | tr ' ' '-'"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

          expect(apiKey).toBe("hello-world");
        }),
      ));

    describe("request-time resolution", () => {
      test("command is executed on every provider lookup", () =>
        runTest(
          Effect.gen(function* () {
            const counterFile = joinPath(tempDir, "counter");
            yield* writeTextFile(counterFile, "0");

            const counterPath = toShPath(counterFile);
            const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
            yield* writeRawModelsJson({
              "custom-provider": providerWithApiKey(command),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            yield* awaited(registry.getApiKeyForProvider("custom-provider"));
            yield* awaited(registry.getApiKeyForProvider("custom-provider"));
            yield* awaited(registry.getApiKeyForProvider("custom-provider"));

            const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
            expect(count).toBe(3);
          }),
        ));

      test("commands are re-executed across registry instances", () =>
        runTest(
          Effect.gen(function* () {
            const counterFile = joinPath(tempDir, "counter");
            yield* writeTextFile(counterFile, "0");

            const counterPath = toShPath(counterFile);
            const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
            yield* writeRawModelsJson({
              "custom-provider": providerWithApiKey(command),
            });

            const registry1 = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            yield* awaited(registry1.getApiKeyForProvider("custom-provider"));

            const registry2 = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            yield* awaited(registry2.getApiKeyForProvider("custom-provider"));

            const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
            expect(count).toBe(2);
          }),
        ));

      test("different commands resolve independently", () =>
        runTest(
          Effect.gen(function* () {
            yield* writeRawModelsJson({
              "provider-a": providerWithApiKey("!echo key-a"),
              "provider-b": providerWithApiKey("!echo key-b"),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            const keyA = yield* awaited(registry.getApiKeyForProvider("provider-a"));
            const keyB = yield* awaited(registry.getApiKeyForProvider("provider-b"));

            expect(keyA).toBe("key-a");
            expect(keyB).toBe("key-b");
          }),
        ));

      test("failed commands are retried", () =>
        runTest(
          Effect.gen(function* () {
            const counterFile = joinPath(tempDir, "counter");
            yield* writeTextFile(counterFile, "0");

            const counterPath = toShPath(counterFile);
            const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; exit 1'`;
            yield* writeRawModelsJson({
              "custom-provider": providerWithApiKey(command),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            const key1 = yield* awaited(registry.getApiKeyForProvider("custom-provider"));
            const key2 = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

            expect(key1).toBeUndefined();
            expect(key2).toBeUndefined();

            const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
            expect(count).toBe(2);
          }),
        ));

      test("provider auth status reports apiKey environment variables from models.json", () =>
        runTest(
          Effect.gen(function* () {
            const envVarName = "TEST_API_KEY_STATUS_TEST_98765";
            const originalEnv = readEnv(envVarName);

            try {
              vi.stubEnv(envVarName, "status-test-key");

              yield* writeRawModelsJson({
                "custom-provider": providerWithApiKey(`$${envVarName}`),
              });

              const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

              expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
                configured: true,
                source: "environment",
                label: envVarName,
              });
            } finally {
              if (originalEnv === undefined) {
                vi.stubEnv(envVarName, undefined);
              } else {
                vi.stubEnv(envVarName, originalEnv);
              }
            }
          }),
        ));

      test("provider auth status reports interpolated apiKey environment variables", () =>
        runTest(
          Effect.gen(function* () {
            const envVarNameA = "TEST_API_KEY_STATUS_PART_A_98765";
            const envVarNameB = "TEST_API_KEY_STATUS_PART_B_98765";
            const originalEnvA = readEnv(envVarNameA);
            const originalEnvB = readEnv(envVarNameB);
            vi.stubEnv(envVarNameA, "left");
            vi.stubEnv(envVarNameB, "right");
            const interpolatedKey = ["$", "{", envVarNameA, "}_$", "{", envVarNameB, "}"].join("");

            try {
              yield* writeRawModelsJson({
                "custom-provider": providerWithApiKey(interpolatedKey),
              });

              const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

              expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
                configured: true,
                source: "environment",
                label: `${envVarNameA}, ${envVarNameB}`,
              });
            } finally {
              if (originalEnvA === undefined) {
                vi.stubEnv(envVarNameA, undefined);
              } else {
                vi.stubEnv(envVarNameA, originalEnvA);
              }
              if (originalEnvB === undefined) {
                vi.stubEnv(envVarNameB, undefined);
              } else {
                vi.stubEnv(envVarNameB, originalEnvB);
              }
            }
          }),
        ));

      test("provider auth status reports non-env apiKey values from models.json as a config key", () =>
        runTest(
          Effect.gen(function* () {
            yield* writeRawModelsJson({
              "custom-provider": providerWithApiKey("literal_api_key_value"),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
              configured: true,
              source: "models_json_key",
            });
          }),
        ));

      test("missing explicit env apiKey keeps provider unavailable", () =>
        runTest(
          Effect.gen(function* () {
            const envVarName = "TEST_API_KEY_MISSING_TEST_98765";
            const originalEnv = readEnv(envVarName);
            vi.stubEnv(envVarName, undefined);

            try {
              yield* writeRawModelsJson({
                "custom-provider": providerWithApiKey(`$${envVarName}`),
              });

              const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

              expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
                configured: false,
              });
              expect(
                registry.getAvailable().some((model) => model.provider === "custom-provider"),
              ).toBe(false);
            } finally {
              if (originalEnv === undefined) {
                vi.stubEnv(envVarName, undefined);
              } else {
                vi.stubEnv(envVarName, originalEnv);
              }
            }
          }),
        ));

      test("provider auth status reports command apiKey values from models.json without executing them", () =>
        runTest(
          Effect.gen(function* () {
            const counterFile = joinPath(tempDir, "status-counter");
            yield* writeTextFile(counterFile, "0");
            const counterPath = toShPath(counterFile);
            const command = `!sh -c 'echo 1 > "${counterPath}"; echo key-value'`;
            yield* writeRawModelsJson({
              "custom-provider": providerWithApiKey(command),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
              configured: true,
              source: "models_json_command",
            });
            expect(yield* readTextFile(counterFile)).toBe("0");
          }),
        ));

      test("environment variables are not cached (changes are picked up)", () =>
        runTest(
          Effect.gen(function* () {
            const envVarName = "TEST_API_KEY_CACHE_TEST_98765";
            const originalEnv = readEnv(envVarName);

            try {
              vi.stubEnv(envVarName, "first-value");

              yield* writeRawModelsJson({
                "custom-provider": providerWithApiKey(`$${envVarName}`),
              });

              const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

              const key1 = yield* awaited(registry.getApiKeyForProvider("custom-provider"));
              expect(key1).toBe("first-value");

              vi.stubEnv(envVarName, "second-value");

              const key2 = yield* awaited(registry.getApiKeyForProvider("custom-provider"));
              expect(key2).toBe("second-value");
            } finally {
              if (originalEnv === undefined) {
                vi.stubEnv(envVarName, undefined);
              } else {
                vi.stubEnv(envVarName, originalEnv);
              }
            }
          }),
        ));

      test("getAvailable does not execute command-backed apiKey resolution", () =>
        runTest(
          Effect.gen(function* () {
            const counterFile = joinPath(tempDir, "counter");
            yield* writeTextFile(counterFile, "0");

            const counterPath = toShPath(counterFile);
            const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
            yield* writeRawModelsJson({
              "custom-provider": providerWithApiKey(command),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            const available = registry.getAvailable();

            expect(available.some((m) => m.provider === "custom-provider")).toBe(true);
            const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
            expect(count).toBe(0);
          }),
        ));

      const filteredChatModel = (id: string): Model<"openai-completions"> => ({
        id,
        name: id,
        api: "openai-completions",
        provider: "filtered-provider",
        baseUrl: "https://provider.test/v1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 1000,
        maxTokens: 100,
      });

      const createLimitedKeyRegistry = (): Promise<ModelRegistry> =>
        runTest(
          Effect.gen(function* () {
            yield* awaited(
              authStorage.modify("filtered-provider", () =>
                runTest(
                  Effect.sync(() => ({
                    type: "api_key",
                    key: "limited-key",
                  })),
                ),
              ),
            );
            return yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          }),
        );

      const registerFilteredProvider = (registry: ModelRegistry, onResolve: () => void): void => {
        registry.registerProvider(
          createProvider({
            id: "filtered-provider",
            auth: {
              apiKey: {
                name: "Filtered",
                resolve: ({ credential }) =>
                  runTest(
                    Effect.sync(() => {
                      onResolve();
                      return credential?.key !== undefined && credential.key.length > 0
                        ? { auth: { apiKey: credential.key } }
                        : undefined;
                    }),
                  ),
              },
            },
            models: [filteredChatModel("allowed"), filteredChatModel("denied")],
            filterModels: (models, credential) =>
              credential?.type === "api_key" && credential.key === "limited-key"
                ? models.filter((m) => m.id === "allowed")
                : models,
            api: {
              stream: () => {
                throw new Error("not used");
              },
              streamSimple: () => {
                throw new Error("not used");
              },
            },
          }),
        );
      };

      const filteredAvailableIds = (registry: ModelRegistry): string[] =>
        registry
          .getAvailable()
          .filter((m) => m.provider === "filtered-provider")
          .map((m) => m.id);

      test("getAvailable applies the provider's credential-specific filterModels", () =>
        runTest(
          Effect.gen(function* () {
            const registry = yield* awaited(createLimitedKeyRegistry());
            registerFilteredProvider(registry, () => {});
            yield* awaited(registry.refresh());

            expect(filteredAvailableIds(registry)).toEqual(["allowed"]);
          }),
        ));

      test("a background refresh that lands during an awaited refresh keeps filterModels", () =>
        runTest(
          Effect.gen(function* () {
            const config = yield* awaited(ModelConfig.load(modelsJsonPath));
            let releaseBackground: () => void = () => {};
            const background = deferredPromise<void>();
            releaseBackground = background.resolve;
            const registry = yield* awaited(createLimitedKeyRegistry());
            vi.spyOn(ModelConfig, "load")
              .mockImplementationOnce(() =>
                runTest(
                  Effect.gen(function* () {
                    yield* awaited(background.promise);
                    return config;
                  }),
                ),
              )
              .mockImplementationOnce(() => runTest(Effect.succeed(config)));
            registerFilteredProvider(registry, () => releaseBackground());
            yield* awaited(registry.refresh());

            expect(filteredAvailableIds(registry)).toEqual(["allowed"]);
          }),
        ));

      test("getApiKeyAndHeaders resolves authHeader on every request", () =>
        runTest(
          Effect.gen(function* () {
            const tokenFile = joinPath(tempDir, "token");
            yield* writeTextFile(tokenFile, "token-1");
            const tokenPath = toShPath(tokenFile);

            yield* writeRawModelsJson({
              "custom-provider": {
                ...providerWithApiKey(`!sh -c 'cat "${tokenPath}"'`),
                authHeader: true,
              },
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            const model = registry.find("custom-provider", "test-model");
            expect(model).toBeDefined();

            const auth1 = yield* awaited(registry.getApiKeyAndHeaders(model!));
            expect(auth1).toEqual({
              ok: true,
              apiKey: "token-1",
              headers: { Authorization: "Bearer token-1" },
            });

            yield* writeTextFile(tokenFile, "token-2");

            const auth2 = yield* awaited(registry.getApiKeyAndHeaders(model!));
            expect(auth2).toEqual({
              ok: true,
              apiKey: "token-2",
              headers: { Authorization: "Bearer token-2" },
            });
          }),
        ));

      test("getApiKeyAndHeaders resolves configured auth exactly once", () =>
        runTest(
          Effect.gen(function* () {
            const counterFile = joinPath(tempDir, "auth-counter");
            yield* writeTextFile(counterFile, "0");
            const counterPath = toShPath(counterFile);
            yield* writeRawModelsJson({
              "custom-provider": {
                ...providerWithApiKey(
                  `!sh -c 'count=$(cat "${counterPath}"); count=$((count + 1)); echo "$count" > "${counterPath}"; echo "token-$count"'`,
                ),
                authHeader: true,
              },
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            const auth = yield* awaited(
              registry.getApiKeyAndHeaders(registry.find("custom-provider", "test-model")!),
            );

            expect(auth).toEqual({
              ok: true,
              apiKey: "token-1",
              headers: { Authorization: "Bearer token-1" },
            });
            expect((yield* readTextFile(counterFile)).trim()).toBe("1");
          }),
        ));

      test("stored credentials bypass lower-priority configured auth commands", () =>
        runTest(
          Effect.gen(function* () {
            const counterFile = joinPath(tempDir, "fallback-counter");
            yield* writeTextFile(counterFile, "0");
            const counterPath = toShPath(counterFile);
            yield* writeRawModelsJson({
              "custom-provider": providerWithApiKey(
                `!sh -c 'echo 1 > "${counterPath}"; echo fallback-key'`,
              ),
            });
            yield* awaited(
              authStorage.modify("custom-provider", () =>
                runTest(
                  Effect.sync(() => ({
                    type: "api_key",
                    key: "stored-key",
                  })),
                ),
              ),
            );

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            const auth = yield* awaited(
              registry.getApiKeyAndHeaders(registry.find("custom-provider", "test-model")!),
            );

            expect(auth).toMatchObject({ ok: true, apiKey: "stored-key" });
            expect((yield* readTextFile(counterFile)).trim()).toBe("0");
          }),
        ));

      test("getApiKeyAndHeaders preserves the legacy missing-key authHeader error", () =>
        runTest(
          Effect.gen(function* () {
            yield* writeRawModelsJson({
              "custom-provider": {
                baseUrl: "https://example.test/v1",
                api: "openai-completions",
                authHeader: true,
                models: [{ id: "test-model" }],
              },
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            const auth = yield* awaited(
              registry.getApiKeyAndHeaders(registry.find("custom-provider", "test-model")!),
            );

            expect(auth).toEqual({ ok: false, error: 'No API key found for "custom-provider"' });
          }),
        ));

      test("getApiKeyAndHeaders returns an error for failed authHeader resolution", () =>
        runTest(
          Effect.gen(function* () {
            yield* writeRawModelsJson({
              "custom-provider": {
                ...providerWithApiKey("!exit 1"),
                authHeader: true,
              },
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            const model = registry.find("custom-provider", "test-model");
            expect(model).toBeDefined();

            const auth = yield* awaited(registry.getApiKeyAndHeaders(model!));
            expect(auth.ok).toBe(false);
            if (!auth.ok) {
              expect(auth.error).toContain(
                'Failed to resolve API key for provider "custom-provider"',
              );
            }
          }),
        ));
    });
  });
});
