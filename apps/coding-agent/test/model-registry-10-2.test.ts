import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import platform from "../src/core/platform/index.ts";
import modelRegistrySupport from "./model-registry-support.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { deleteEnv, readEnv, writeEnv } = platform;

const { createModelRegistry } = modelRuntimeTestUtils;
const { providerWithApiKey, useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { awaited, runTest } = testing;

const apikeyWithPrefixExecutesCommandAndUses = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "custom-provider": providerWithApiKey("!echo test-api-key-from-command"),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBe("test-api-key-from-command");
    }),
  );

const apikeyWithPrefixTrimsWhitespaceFromCommand = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "custom-provider": providerWithApiKey("!echo '  spaced-key  '"),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBe("spaced-key");
    }),
  );

const apikeyWithPrefixHandlesMultilineOutputUses = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "custom-provider": providerWithApiKey("!printf 'line1\\nline2'"),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBe("line1\nline2");
    }),
  );

const apikeyWithPrefixReturnsUndefinedOnCommand = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "custom-provider": providerWithApiKey("!exit 1"),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBeUndefined();
    }),
  );

const apikeyWithPrefixReturnsUndefinedOnNonexistent = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "custom-provider": providerWithApiKey("!nonexistent-command-12345"),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBeUndefined();
    }),
  );

const apikeyWithPrefixReturnsUndefinedOnEmpty = () =>
  runTest(
    Effect.gen(function* () {
      yield* fixture.writeRawModelsJson({
        "custom-provider": providerWithApiKey("!printf ''"),
      });

      const registry = yield* awaited(
        createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
      );
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBeUndefined();
    }),
  );

const apikeyWithPrefixResolvesToEnvValue = () =>
  runTest(
    Effect.gen(function* () {
      const originalEnv = readEnv("TEST_API_KEY_12345");
      writeEnv("TEST_API_KEY_12345", "env-api-key-value");

      try {
        yield* fixture.writeRawModelsJson({
          "custom-provider": providerWithApiKey("$TEST_API_KEY_12345"),
        });

        const registry = yield* awaited(
          createModelRegistry(fixture.authStorage, fixture.modelsJsonPath),
        );
        const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

        expect(apiKey).toBe("env-api-key-value");
      } finally {
        if (originalEnv === undefined) {
          deleteEnv("TEST_API_KEY_12345");
        } else {
          writeEnv("TEST_API_KEY_12345", originalEnv);
        }
      }
    }),
  );

describe("ModelRegistry", () => {
  describe("API key resolution", () => {
    test(
      "apiKey with ! prefix executes command and uses stdout",
      apikeyWithPrefixExecutesCommandAndUses,
    );

    test(
      "apiKey with ! prefix trims whitespace from command output",
      apikeyWithPrefixTrimsWhitespaceFromCommand,
    );

    test(
      "apiKey with ! prefix handles multiline output (uses trimmed result)",
      apikeyWithPrefixHandlesMultilineOutputUses,
    );

    test(
      "apiKey with ! prefix returns undefined on command failure",
      apikeyWithPrefixReturnsUndefinedOnCommand,
    );

    test(
      "apiKey with ! prefix returns undefined on nonexistent command",
      apikeyWithPrefixReturnsUndefinedOnNonexistent,
    );

    test(
      "apiKey with ! prefix returns undefined on empty output",
      apikeyWithPrefixReturnsUndefinedOnEmpty,
    );

    test("apiKey with $ prefix resolves to env value", apikeyWithPrefixResolvesToEnvValue);
  });
});
