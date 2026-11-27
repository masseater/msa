import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import modelRegistry4Support from "./model-registry-4-support.ts";
import modelRegistrySupport from "./model-registry-support.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { providerConfig, getModelsForProvider } = modelRegistry4Support;

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, runTest } = testing;

const modelsOnlyCustomProviderRegistrationSurvivesRefresh = () =>
  runTest(
    Effect.gen(function* () {
      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );

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
      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );

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
      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );

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

describe("ModelRegistry", () => {
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
