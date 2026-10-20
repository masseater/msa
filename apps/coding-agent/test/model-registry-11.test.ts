import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import type authStorageTypes from "../src/core/auth-storage.types.ts";
import processEnv from "../src/core/process-env.ts";
import providerComposer from "../src/core/provider-composer.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
const { deleteEnv, readEnv, writeEnv } = processEnv;
const { clearApiKeyCache } = providerComposer;

const { createModelRegistry } = modelRuntimeTestUtils;

const {
  awaited,
  joinPath,
  makeTempDir,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  writeJsonFile,
  writeTextFile,
} = testing;

let tempDir: string;

let modelsJsonPath: string;

let authStorage: authStorageTypes.AuthStorage;

function toShPath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/"/gu, '\\"');
}

const writeRawModelsJson = (providers: Record<string, unknown>) =>
  writeJsonFile(modelsJsonPath, { providers });

function providerWithApiKey(apiKey: string) {
  return {
    api: "anthropic-messages",
    apiKey,
    baseUrl: "https://example.com/v1",
    models: [
      {
        contextWindow: 100000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "test-model",
        input: ["text"],
        maxTokens: 8000,
        name: "Test Model",
        reasoning: false,
      },
    ],
  };
}

const apikeyWithBracedEnvSyntaxResolvesTo = () =>
  runTest(
    Effect.gen(function* () {
      const originalEnv = readEnv("TEST_BRACED_API_KEY_12345");
      writeEnv("TEST_BRACED_API_KEY_12345", "braced-env-api-key-value");
      const bracedKey = "${TEST_BRACED_API_KEY_12345}";

      try {
        yield* writeRawModelsJson({
          "custom-provider": providerWithApiKey(bracedKey),
        });

        const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
        const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

        expect(apiKey).toBe("braced-env-api-key-value");
      } finally {
        if (originalEnv === undefined) {
          deleteEnv("TEST_BRACED_API_KEY_12345");
        } else {
          writeEnv("TEST_BRACED_API_KEY_12345", originalEnv);
        }
      }
    }),
  );

const apikeyInterpolatesBracedEnvReferencesInsideLiterals = () =>
  runTest(
    Effect.gen(function* () {
      const originalPartA = readEnv("TEST_INTERPOLATED_PART_A_12345");
      const originalPartB = readEnv("TEST_INTERPOLATED_PART_B_12345");
      writeEnv("TEST_INTERPOLATED_PART_A_12345", "left");
      writeEnv("TEST_INTERPOLATED_PART_B_12345", "right");
      const interpolatedKey = [
        "$",
        "{TEST_INTERPOLATED_PART_A_12345}_$",
        "{TEST_INTERPOLATED_PART_B_12345}",
      ].join("");

      try {
        yield* writeRawModelsJson({
          "custom-provider": providerWithApiKey(interpolatedKey),
        });

        const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
        const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

        expect(apiKey).toBe("left_right");
      } finally {
        if (originalPartA === undefined) {
          deleteEnv("TEST_INTERPOLATED_PART_A_12345");
        } else {
          writeEnv("TEST_INTERPOLATED_PART_A_12345", originalPartA);
        }
        if (originalPartB === undefined) {
          deleteEnv("TEST_INTERPOLATED_PART_B_12345");
        } else {
          writeEnv("TEST_INTERPOLATED_PART_B_12345", originalPartB);
        }
      }
    }),
  );

const apikeyWithPrefixEscapesALeadingDollar = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey("$$TEST_API_KEY_12345"),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBe("$TEST_API_KEY_12345");
    }),
  );

const apikeyWithEscapesALiteralBangAnd = () =>
  runTest(
    Effect.gen(function* () {
      const originalEnv = readEnv("TEST_API_KEY_12345");
      writeEnv("TEST_API_KEY_12345", "env-api-key-value");

      try {
        yield* writeRawModelsJson({
          "custom-provider": providerWithApiKey("$!literal-$TEST_API_KEY_12345"),
        });

        const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
        const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

        expect(apiKey).toBe("!literal-env-api-key-value");
      } finally {
        if (originalEnv === undefined) {
          deleteEnv("TEST_API_KEY_12345");
        } else {
          writeEnv("TEST_API_KEY_12345", originalEnv);
        }
      }
    }),
  );

const plainApikeyIsUsedDirectlyEvenWhen = () =>
  runTest(
    Effect.gen(function* () {
      const originalEnv = readEnv("TEST_API_KEY_12345");
      writeEnv("TEST_API_KEY_12345", "env-api-key-value");

      try {
        yield* writeRawModelsJson({
          "custom-provider": providerWithApiKey("TEST_API_KEY_12345"),
        });

        const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
        const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

        expect(apiKey).toBe("TEST_API_KEY_12345");
      } finally {
        if (originalEnv === undefined) {
          deleteEnv("TEST_API_KEY_12345");
        } else {
          writeEnv("TEST_API_KEY_12345", originalEnv);
        }
      }
    }),
  );

const apikeyAsLiteralValueIsUsedDirectly = () =>
  runTest(
    Effect.gen(function* () {
      deleteEnv("literal_api_key_value");

      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey("literal_api_key_value"),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBe("literal_api_key_value");
    }),
  );

const apikeyCommandCanUseShellFeaturesLike = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey("!echo 'hello world' | tr ' ' '-'"),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      expect(apiKey).toBe("hello-world");
    }),
  );

const commandIsExecutedOnEveryProviderLookup = () =>
  runTest(
    Effect.gen(function* () {
      const counterFile = joinPath(tempDir, "counter");
      yield* writeTextFile(counterFile, "0");

      const counterPath = toShPath(counterFile);
      const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey(command),
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      yield* awaited(registry.getApiKeyForProvider("custom-provider"));
      yield* awaited(registry.getApiKeyForProvider("custom-provider"));
      yield* awaited(registry.getApiKeyForProvider("custom-provider"));

      const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
      expect(count).toBe(3);
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

  describe("API key resolution", () => {
    test(
      "apiKey with braced env syntax resolves to env value",
      apikeyWithBracedEnvSyntaxResolvesTo,
    );

    test(
      "apiKey interpolates braced env references inside literals",
      apikeyInterpolatesBracedEnvReferencesInsideLiterals,
    );

    test("apiKey with $$ prefix escapes a leading dollar", apikeyWithPrefixEscapesALeadingDollar);

    test(
      "apiKey with $! escapes a literal bang and still interpolates later env refs",
      apikeyWithEscapesALiteralBangAnd,
    );

    test(
      "plain apiKey is used directly even when it matches an env var",
      plainApikeyIsUsedDirectlyEvenWhen,
    );

    test(
      "apiKey as literal value is used directly when not an env var",
      apikeyAsLiteralValueIsUsedDirectly,
    );

    test("apiKey command can use shell features like pipes", apikeyCommandCanUseShellFeaturesLike);

    describe("request-time resolution", () => {
      test("command is executed on every provider lookup", commandIsExecutedOnEveryProviderLookup);
    });
  });
});
