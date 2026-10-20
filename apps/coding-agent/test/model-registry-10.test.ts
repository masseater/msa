import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import {
  type ModelRegistry,
  type ProviderConfigInput,
  clearApiKeyCache,
} from "../src/core/model-registry.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeTempDir, randomSuffixSync, removePath, runTest } = testing;

let tempDir: string;

let modelsJsonPath: string;

let authStorage: AuthStorage;

function providerConfig(
  baseUrl: string,
  models: Array<{ id: string; name?: string }>,
  api: string = "anthropic-messages",
): ProviderConfigInput {
  return {
    api: api as compatTypes.Api,
    apiKey: "test-key",
    baseUrl,
    models: models.map((m) => ({
      contextWindow: 100000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: m.id,
      input: ["text"],
      maxTokens: 8000,
      name: m.name ?? m.id,
      reasoning: false,
    })),
  };
}

function getModelsForProvider(registry: ModelRegistry, provider: string) {
  return registry.getAll().filter((m) => m.provider === provider);
}

const modelsOnlyCustomProviderRegistrationSurvivesRefresh = () =>
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
  );

const baseurlOnlyOverrideKeepsCustomProviderModels = () =>
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
  );

const headersOnlyOverrideKeepsCustomProviderModels = () =>
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
        headers: { "x-proxy": "enabled" },
        ok: true,
      });
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

  describe("dynamic provider lifecycle", () => {
    describe("dynamic provider override persistence", () => {
      test(
        "models-only custom provider registration survives refresh",
        modelsOnlyCustomProviderRegistrationSurvivesRefresh,
      );

      test(
        "baseUrl-only override keeps custom provider models after refresh",
        baseurlOnlyOverrideKeepsCustomProviderModels,
      );

      test(
        "headers-only override keeps custom provider models after refresh",
        headersOnlyOverrideKeepsCustomProviderModels,
      );
    });
  });
});
