import type { Api } from "@msa/ai/compat";
import { getApiProvider } from "@msa/ai/compat";
import {
  awaited,
  currentTimeMillis,
  joinPath,
  makeTempDir,
  randomSuffixSync,
  removePath,
  runTest,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import {
  clearApiKeyCache,
  type ModelRegistry,
  type ProviderConfigInput,
} from "../src/core/model-registry.ts";
import { openAiModel, emptyContext, captureThrown } from "./model-registry-support.ts";
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

  describe("dynamic provider lifecycle", () => {
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

    test("unregisterProvider removes the runtime OAuth overlay without mutating global state", () =>
      runTest(
        Effect.gen(function* () {
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

          registry.registerProvider("anthropic-api", {
            oauth: {
              name: "Custom Anthropic OAuth",
              login: () =>
                effectRunPromise(
                  awaited({
                    access: "custom-access-token",
                    refresh: "custom-refresh-token",
                    expires: currentTimeMillis() + 60_000,
                  }),
                ),
              refreshToken: (credentials) => effectRunPromise(awaited(credentials)),
              getApiKey: (credentials) => credentials.access,
            },
          });

          expect(registry.getRegisteredProviderConfig("anthropic-api")?.oauth?.name).toBe(
            "Custom Anthropic OAuth",
          );

          registry.unregisterProvider("anthropic-api");

          expect(registry.getRegisteredProviderConfig("anthropic-api")).toBeUndefined();
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

          expect(
            captureThrown(() =>
              getApiProvider("openai-completions")?.streamSimple(openAiModel, emptyContext),
            ),
          ).toBeUndefined();

          registry.unregisterProvider("stream-override-provider");

          expect(
            captureThrown(() =>
              getApiProvider("openai-completions")?.streamSimple(openAiModel, emptyContext),
            ),
          ).toBeUndefined();
        }),
      ));

    describe("dynamic provider override persistence", () => {
      test("baseUrl-only override keeps built-in provider models after refresh", () =>
        runTest(
          Effect.gen(function* () {
            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            registry.registerProvider("anthropic-api", { baseUrl: "https://proxy.test/anthropic" });
            yield* awaited(registry.refresh());

            const anthropicModels = getModelsForProvider(registry, "anthropic-api");
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

            registry.registerProvider("anthropic-api", {
              ...providerConfig(
                "https://custom.test/anthropic",
                [{ id: "custom-claude" }],
                "anthropic-messages",
              ),
              baseUrl: "https://custom.test/anthropic",
            });
            yield* awaited(registry.refresh());

            expect(getModelsForProvider(registry, "anthropic-api").map((m) => m.id)).toEqual([
              "custom-claude",
            ]);
            expect(registry.find("anthropic-api", "custom-claude")?.baseUrl).toBe(
              "https://custom.test/anthropic",
            );
          }),
        ));

      test("models plus baseUrl override replaces built-in provider models after refresh", () =>
        runTest(
          Effect.gen(function* () {
            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            registry.registerProvider("anthropic-api", {
              ...providerConfig(
                "https://custom.test/anthropic",
                [{ id: "custom-claude" }],
                "anthropic-messages",
              ),
              baseUrl: "https://custom.test/anthropic",
            });
            registry.registerProvider("anthropic-api", { baseUrl: "https://proxy.test/anthropic" });
            yield* awaited(registry.refresh());

            expect(getModelsForProvider(registry, "anthropic-api").map((m) => m.id)).toEqual([
              "custom-claude",
            ]);
            expect(registry.find("anthropic-api", "custom-claude")?.baseUrl).toBe(
              "https://proxy.test/anthropic",
            );
          }),
        ));
    });
  });
});
