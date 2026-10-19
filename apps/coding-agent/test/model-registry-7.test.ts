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
    test("model override can add headers at request time", () =>
      runTest(
        Effect.gen(function* () {
          writeRawModelsJson({
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
          writeRawModelsJson({
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

          writeRawModelsJson({
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
          writeRawModelsJson({
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

          writeRawModelsJson({});
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
          const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

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
                effectRunPromise(
                  awaited({
                    access: "access",
                    refresh: "refresh",
                    expires: currentTimeMillis() + 60_000,
                  }),
                ),
              refreshToken: (credentials) => effectRunPromise(awaited(credentials)),
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
  });
});
