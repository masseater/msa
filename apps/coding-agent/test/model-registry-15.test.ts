import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import modelRegistrySupport from "./model-registry-support.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, runTest } = testing;

const builtInProviderCustomModelsInheritApi = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        openrouter: {
          models: [
            {
              id: "fake-provider/fake-model",
              input: ["text"],
              name: "Fake model",
              reasoning: true,
            },
          ],
        },
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      expect(registry.getError()).toBeUndefined();

      const model = registry.find("openrouter", "fake-provider/fake-model");
      expect(model).toBeDefined();
      expect(model?.api).toBe("openai-completions");
      expect(model?.baseUrl).toBe("https://openrouter.ai/api/v1");
    }),
  );

describe("ModelRegistry", () => {
  describe("custom models merge behavior", () => {
    test(
      "built-in provider custom models inherit api and baseUrl without explicit fields",
      builtInProviderCustomModelsInheritApi,
    );
  });
});
