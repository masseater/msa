import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import type authStorageTypes from "../src/core/auth-storage.types.ts";
import providerAuth from "../src/core/provider-composer/provider-auth.ts";
import modelRegistry4Support from "./model-registry-4-support.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { providerConfig, getModelsForProvider } = modelRegistry4Support;
const { clearApiKeyCache } = providerAuth;

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeTempDir, randomSuffixSync, removePath, runTest } = testing;

let tempDir: string;

let modelsJsonPath: string;

let authStorage: authStorageTypes.AuthStorage;

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
