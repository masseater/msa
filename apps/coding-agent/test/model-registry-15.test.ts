import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import modelRegistrySupport from "./model-registry-support.ts";

const { useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { runTest } = testing;

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

      const registry = yield* fixture.registry();
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
