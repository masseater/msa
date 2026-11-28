import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import modelRegistrySupport from "./model-registry-support.ts";

const { toShPath, providerWithApiKey, useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { awaited, joinPath, readTextFile, runTest, writeTextFile } = testing;

const commandIsExecutedOnEveryProviderLookup = () =>
  runTest(
    Effect.gen(function* () {
      const counterFile = joinPath(fixture.tempDir, "counter");
      yield* writeTextFile(counterFile, "0");

      const counterPath = toShPath(counterFile);
      const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
      yield* fixture.writeRawModelsJson({
        "custom-provider": providerWithApiKey(command),
      });

      const registry = yield* fixture.registry();
      yield* awaited(registry.getApiKeyForProvider("custom-provider"));
      yield* awaited(registry.getApiKeyForProvider("custom-provider"));
      yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
      expect(count).toBe(3);
    }),
  );

describe("ModelRegistry", () => {
  describe("API key resolution", () => {
    describe("request-time resolution", () => {
      test("command is executed on every provider lookup", commandIsExecutedOnEveryProviderLookup);
    });
  });
});
