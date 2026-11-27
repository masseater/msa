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

const { awaited, runTest, toJsonText, writeTextFile } = testing;

const writeModelsJson = Effect.fn("writeModelsJson")(function* (
  providers: Record<string, ReturnType<typeof providerConfig>>,
) {
  yield* writeTextFile(fixture.modelsJsonPath, yield* toJsonText({ providers }));
});

const nonBuiltInProviderCustomModelsStill = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "my-custom-provider": {
          apiKey: "test-key",
          models: [
            {
              api: "openai-completions",
              id: "my-model",
              input: ["text"],
              reasoning: false,
            },
          ],
        },
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      expect(registry.getError()).toContain("baseUrl");
    }),
  );

const reportsEveryProviderCompositionError = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "broken-one": { api: "openai-completions", models: [{ id: "one" }] },
        "broken-two": { api: "openai-completions", models: [{ id: "two" }] },
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const error = registry.getError();

      expect(error).toContain('Provider "broken-one"');
      expect(error).toContain('Provider "broken-two"');
    }),
  );

const customProviderWithSameNameAsBuilt = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeModelsJson({
        "anthropic-api": providerConfig("https://my-proxy.example.com/v1", [
          { id: "claude-custom" },
        ]),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      expect(anthropicModels.length).toBeGreaterThan(1);
      expect(anthropicModels.some((m) => m.id === "claude-custom")).toBe(true);
      expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
    }),
  );

const customModelWithSameIdReplacesBuilt = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeModelsJson({
        openrouter: providerConfig(
          "https://my-proxy.example.com/v1",
          [{ id: "anthropic/claude-sonnet-4.5" }],
          "openai-completions",
        ),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const models = getModelsForProvider(registry, "openrouter");
      const sonnetModels = models.filter((m) => m.id === "anthropic/claude-sonnet-4.5");

      expect(sonnetModels).toHaveLength(1);
      expect(sonnetModels[0]?.baseUrl).toBe("https://my-proxy.example.com/v1");
    }),
  );

const customProviderWithSameNameAsBuilt2 = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeModelsJson({
        "anthropic-api": providerConfig("https://my-proxy.example.com/v1", [
          { id: "claude-custom" },
        ]),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );

      expect(getModelsForProvider(registry, "opencode").length).toBeGreaterThan(0);
      expect(getModelsForProvider(registry, "openai").length).toBeGreaterThan(0);
    }),
  );

const providerLevelBaseurlAppliesToBothBuilt = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeModelsJson({
        "anthropic-api": providerConfig("https://merged-proxy.example.com/v1", [
          { id: "claude-custom" },
        ]),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const anthropicModels = getModelsForProvider(registry, "anthropic-api");

      for (const model of anthropicModels) {
        expect(model.baseUrl).toBe("https://merged-proxy.example.com/v1");
      }
    }),
  );

describe("ModelRegistry", () => {
  describe("custom models merge behavior", () => {
    test(
      "non-built-in provider custom models still require baseUrl",
      nonBuiltInProviderCustomModelsStill,
    );

    test("reports every provider composition error", reportsEveryProviderCompositionError);

    test(
      "custom provider with same name as built-in merges with built-in models",
      customProviderWithSameNameAsBuilt,
    );
  });
});

describe("ModelRegistry", () => {
  describe("custom models merge behavior", () => {
    test(
      "custom model with same id replaces built-in model by id",
      customModelWithSameIdReplacesBuilt,
    );

    test(
      "custom provider with same name as built-in does not affect other built-in providers",
      customProviderWithSameNameAsBuilt2,
    );

    test(
      "provider-level baseUrl applies to both built-in and custom models",
      providerLevelBaseurlAppliesToBothBuilt,
    );
  });
});
