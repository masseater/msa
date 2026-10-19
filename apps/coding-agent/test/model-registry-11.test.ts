import {
  awaited,
  joinPath,
  makeTempDir,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { clearApiKeyCache } from "../src/core/model-registry.ts";
import { readEnv, writeEnv, deleteEnv } from "../src/core/process-env.ts";
import { nodeFs } from "./model-registry-support.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";

describe("ModelRegistry", () => {
  let tempDir: string;

  let modelsJsonPath: string;

  let authStorage: AuthStorage;

  function toShPath(value: string): string {
    return value.replace(/\\/gu, "/").replace(/"/gu, '\\"');
  }

  function writeRawModelsJson(providers: Record<string, unknown>) {
    nodeFs.writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
  }

  function providerWithApiKey(apiKey: string) {
    return {
      baseUrl: "https://example.com/v1",
      apiKey,
      api: "anthropic-messages",
      models: [
        {
          id: "test-model",
          name: "Test Model",
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 100000,
          maxTokens: 8000,
        },
      ],
    };
  }

  beforeEach(() =>
    runTest(makeTempDir(`msa-test-model-registry-${randomSuffixSync()}-`)).then((dir) => {
      tempDir = dir;
      modelsJsonPath = joinPath(tempDir, "models.json");
      authStorage = AuthStorage.inMemory();
      return dir;
    }),
  );

  afterEach(() => {
    clearApiKeyCache();
    vi.restoreAllMocks();
    return runTest(removePath(tempDir));
  });

  describe("API key resolution", () => {
    test("apiKey with braced env syntax resolves to env value", () =>
      runTest(
        Effect.gen(function* () {
          const originalEnv = readEnv("TEST_BRACED_API_KEY_12345");
          writeEnv("TEST_BRACED_API_KEY_12345", "braced-env-api-key-value");
          const bracedKey = "${TEST_BRACED_API_KEY_12345}";

          try {
            writeRawModelsJson({
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
      ));

    test("apiKey interpolates braced env references inside literals", () =>
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
            writeRawModelsJson({
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
      ));

    test("apiKey with $$ prefix escapes a leading dollar", () =>
      runTest(
        Effect.gen(function* () {
          writeRawModelsJson({
            "custom-provider": providerWithApiKey("$$TEST_API_KEY_12345"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

          expect(apiKey).toBe("$TEST_API_KEY_12345");
        }),
      ));

    test("apiKey with $! escapes a literal bang and still interpolates later env refs", () =>
      runTest(
        Effect.gen(function* () {
          const originalEnv = readEnv("TEST_API_KEY_12345");
          writeEnv("TEST_API_KEY_12345", "env-api-key-value");

          try {
            writeRawModelsJson({
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
      ));

    test("plain apiKey is used directly even when it matches an env var", () =>
      runTest(
        Effect.gen(function* () {
          const originalEnv = readEnv("TEST_API_KEY_12345");
          writeEnv("TEST_API_KEY_12345", "env-api-key-value");

          try {
            writeRawModelsJson({
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
      ));

    test("apiKey as literal value is used directly when not an env var", () =>
      runTest(
        Effect.gen(function* () {
          deleteEnv("literal_api_key_value");

          writeRawModelsJson({
            "custom-provider": providerWithApiKey("literal_api_key_value"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

          expect(apiKey).toBe("literal_api_key_value");
        }),
      ));

    test("apiKey command can use shell features like pipes", () =>
      runTest(
        Effect.gen(function* () {
          writeRawModelsJson({
            "custom-provider": providerWithApiKey("!echo 'hello world' | tr ' ' '-'"),
          });

          const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
          const apiKey = yield* awaited(registry.getApiKeyForProvider("custom-provider"));

          expect(apiKey).toBe("hello-world");
        }),
      ));

    describe("request-time resolution", () => {
      test("command is executed on every provider lookup", () =>
        runTest(
          Effect.gen(function* () {
            const counterFile = joinPath(tempDir, "counter");
            yield* writeTextFile(counterFile, "0");

            const counterPath = toShPath(counterFile);
            const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
            writeRawModelsJson({
              "custom-provider": providerWithApiKey(command),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
            yield* awaited(registry.getApiKeyForProvider("custom-provider"));
            yield* awaited(registry.getApiKeyForProvider("custom-provider"));
            yield* awaited(registry.getApiKeyForProvider("custom-provider"));

            const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
            expect(count).toBe(3);
          }),
        ));
    });
  });
});
