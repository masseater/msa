import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import type modelConfigTypes from "../src/core/model-config.types.ts";
import modelRegistry4Support from "./model-registry-4-support.ts";
import modelRegistrySupport from "./model-registry-support.ts";

const { useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { getModelsForProvider } = modelRegistry4Support;

const { runTest } = testing;

const modelOverrideWithCompatOpenrouterrouting = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
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

      const registry = yield* fixture.registry();
      const models = getModelsForProvider(registry, "openrouter");

      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      const compat = sonnet?.compat as compatTypes.OpenAICompletionsCompat | undefined;
      expect(compat?.openRouterRouting).toEqual({ only: ["amazon-bedrock"] });
    }),
  );

const supportsfinishreasonCanBeConfiguredAtProviderAnd = () =>
  runTest(
    Effect.gen(function* () {
      const provider: modelConfigTypes.ModelsJsonProvider = {
        compat: { supportsFinishReason: true },
        modelOverrides: {
          "anthropic/claude-sonnet-4.5": {
            compat: { supportsFinishReason: false },
          },
        },
      };
      yield* fixture.writeRawModelsJson({ openrouter: provider });

      const registry = yield* fixture.registry();
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((model) => model.id === "anthropic/claude-sonnet-4.5");
      const opus = models.find((model) => model.id === "anthropic/claude-opus-4.1");

      expect(
        (sonnet?.compat as compatTypes.OpenAICompletionsCompat | undefined)?.supportsFinishReason,
      ).toBe(false);
      expect(
        (opus?.compat as compatTypes.OpenAICompletionsCompat | undefined)?.supportsFinishReason,
      ).toBe(true);
    }),
  );

const modelOverrideDeepMergesCompatSettings = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
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

      const registry = yield* fixture.registry();
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

      const compat = sonnet?.compat as compatTypes.OpenAICompletionsCompat | undefined;
      expect(compat?.openRouterRouting).toEqual({ order: ["anthropic-api", "together"] });
    }),
  );

const multipleModelOverridesOnSameProvider = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-opus-4.1": {
              compat: { openRouterRouting: { only: ["anthropic-api"] } },
            },
            "anthropic/claude-sonnet-4.5": {
              compat: { openRouterRouting: { only: ["amazon-bedrock"] } },
            },
          },
        },
      });

      const registry = yield* fixture.registry();
      const models = getModelsForProvider(registry, "openrouter");

      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");

      const sonnetCompat = sonnet?.compat as compatTypes.OpenAICompletionsCompat | undefined;
      const opusCompat = opus?.compat as compatTypes.OpenAICompletionsCompat | undefined;
      expect(sonnetCompat?.openRouterRouting).toEqual({ only: ["amazon-bedrock"] });
      expect(opusCompat?.openRouterRouting).toEqual({ only: ["anthropic-api"] });
    }),
  );

const modelOverrideCombinedWithBaseurlOverride = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        openrouter: {
          baseUrl: "https://my-proxy.example.com/v1",
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Proxied Sonnet",
            },
          },
        },
      });

      const registry = yield* fixture.registry();
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

      expect(sonnet?.baseUrl).toBe("https://my-proxy.example.com/v1");
      expect(sonnet?.name).toBe("Proxied Sonnet");

      const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");
      expect(opus?.baseUrl).toBe("https://my-proxy.example.com/v1");
      expect(opus?.name).not.toBe("Proxied Sonnet");
    }),
  );

const modelOverrideForNonExistentModelId = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "nonexistent/model-id": {
              name: "This should not appear",
            },
          },
        },
      });

      const registry = yield* fixture.registry();
      const models = getModelsForProvider(registry, "openrouter");

      expect(models.find((m) => m.id === "nonexistent/model-id")).toBeUndefined();

      expect(registry.getError()).toBeUndefined();
    }),
  );

const modelOverrideCanChangeCostFieldsPartially = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              cost: { input: 99 },
            },
          },
        },
      });

      const registry = yield* fixture.registry();
      const models = getModelsForProvider(registry, "openrouter");
      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");

      expect(sonnet?.cost.input).toBe(99);

      expect(sonnet?.cost.output).toBeGreaterThan(0);
    }),
  );

describe("ModelRegistry", () => {
  describe("modelOverrides (per-model customization)", () => {
    test("model override with compat.openRouterRouting", modelOverrideWithCompatOpenrouterrouting);

    test(
      "supportsFinishReason can be configured at provider and model levels",
      supportsfinishreasonCanBeConfiguredAtProviderAnd,
    );

    test("model override deep merges compat settings", modelOverrideDeepMergesCompatSettings);

    test("multiple model overrides on same provider", multipleModelOverridesOnSameProvider);

    test("model override combined with baseUrl override", modelOverrideCombinedWithBaseurlOverride);

    test("model override for non-existent model ID is ignored", modelOverrideForNonExistentModelId);

    test(
      "model override can change cost fields partially",
      modelOverrideCanChangeCostFieldsPartially,
    );
  });
});
