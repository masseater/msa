import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import modelRegistry4Support from "./model-registry-4-support.ts";
import modelRegistrySupport from "./model-registry-support.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { getModelsForProvider, providerConfig } = modelRegistry4Support;

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, runTest, toJsonText, writeTextFile } = testing;

const writeModelsJson = Effect.fn("writeModelsJson")(function* (
  providers: Record<string, ReturnType<typeof providerConfig>>,
) {
  yield* writeTextFile(fixture.modelsJsonPath, yield* toJsonText({ providers }));
});

const removingCustomModelsFromModelsJsonKeeps = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeModelsJson({
        "anthropic-api": providerConfig("https://proxy.example.com/v1", [{ id: "claude-custom" }]),
      });
      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      expect(
        getModelsForProvider(registry, "anthropic-api").some((m) => m.id === "claude-custom"),
      ).toBe(true);

      yield* writeModelsJson({});
      yield* awaited(registry.refresh());

      const anthropicModels = getModelsForProvider(registry, "anthropic-api");
      expect(anthropicModels.some((m) => m.id === "claude-custom")).toBe(false);
      expect(anthropicModels.some((m) => m.id.includes("claude"))).toBe(true);
    }),
  );

const modelOverrideAppliesToASingleBuilt = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        openrouter: {
          modelOverrides: {
            "anthropic/claude-sonnet-4.5": {
              name: "Custom Sonnet Name",
            },
          },
        },
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const models = getModelsForProvider(registry, "openrouter");

      const sonnet = models.find((m) => m.id === "anthropic/claude-sonnet-4.5");
      expect(sonnet?.name).toBe("Custom Sonnet Name");

      const opus = models.find((m) => m.id === "anthropic/claude-opus-4.1");
      expect(opus?.name).not.toBe("Custom Sonnet Name");
    }),
  );

const anthropicModelOverrideReplacesAllowedFallbackMetadata = () =>
  runTest(
    Effect.gen(function* () {
      const allowedFallbackModels = [
        {
          cost: { cacheRead: 0.5, cacheWrite: 6.25, input: 5, output: 25 },
          model: "claude-opus-5",
          provider: "anthropic-api",
        },
        {
          cost: { cacheRead: 0.4, cacheWrite: 5, input: 4, output: 20 },
          model: "claude-opus-4-8",
          provider: "anthropic-api",
        },
      ];
      yield* fixture.writeRawModelsJson({
        "anthropic-api": {
          modelOverrides: {
            "claude-fable-5": {
              compat: { allowedFallbackModels },
            },
          },
        },
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const compat = registry.find("anthropic-api", "claude-fable-5")?.compat as
        | compatTypes.AnthropicMessagesCompat
        | undefined;

      expect(registry.getError()).toBeUndefined();
      expect(compat?.allowedFallbackModels).toEqual(allowedFallbackModels);
    }),
  );

describe("ModelRegistry", () => {
  describe("custom models merge behavior", () => {
    test(
      "removing custom models from models.json keeps built-in provider models",
      removingCustomModelsFromModelsJsonKeeps,
    );
  });

  describe("modelOverrides (per-model customization)", () => {
    test("model override applies to a single built-in model", modelOverrideAppliesToASingleBuilt);

    test(
      "Anthropic model override replaces allowed fallback metadata",
      anthropicModelOverrideReplacesAllowedFallbackMetadata,
    );
  });
});
