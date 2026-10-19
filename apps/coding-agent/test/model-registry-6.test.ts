import type { OpenAICompletionsCompat } from "@msa/ai/compat";
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
import { type ModelsJsonProvider } from "../src/core/model-config.ts";
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

  describe("modelOverrides (per-model customization)", () => {
    test("model override with compat.openRouterRouting", () =>
      runTest(
        Effect.gen(function* () {
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
          writeRawModelsJson({ openrouter: provider });

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
          writeRawModelsJson({
            openrouter: {
              modelOverrides: {
                "anthropic/claude-sonnet-4.5": {
                  compat: {
                    openRouterRouting: { order: ["anthropic-api", "together"] },
                  },
                },
              },
            },
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const models = getModelsForProvider(registry, "openrouter");
          const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

          const compat = sonnet?.compat as OpenAICompletionsCompat | undefined;
          expect(compat?.openRouterRouting).toEqual({ order: ["anthropic-api", "together"] });
        }),
      ));

    test("multiple model overrides on same provider", () =>
      runTest(
        Effect.gen(function* () {
          writeRawModelsJson({
            openrouter: {
              modelOverrides: {
                "anthropic/claude-sonnet-4.5": {
                  compat: { openRouterRouting: { only: ["amazon-bedrock"] } },
                },
                "anthropic/claude-opus-4.1": {
                  compat: { openRouterRouting: { only: ["anthropic-api"] } },
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
          expect(opusCompat?.openRouterRouting).toEqual({ only: ["anthropic-api"] });
        }),
      ));

    test("model override combined with baseUrl override", () =>
      runTest(
        Effect.gen(function* () {
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
          writeRawModelsJson({
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
          writeRawModelsJson({
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
  });
});
