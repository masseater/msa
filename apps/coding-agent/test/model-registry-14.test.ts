import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import type authStorageTypes from "../src/core/auth-storage.types.ts";
import platform from "../src/core/platform/index.ts";
import providerAuth from "../src/core/provider-composer/provider-auth.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
const { deleteEnv, readEnv, writeEnv } = platform;
const { clearApiKeyCache } = providerAuth;

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

const storedCredentialsBypassLowerPriorityConfiguredAuth = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const counterFile = joinPath(tempDir, "fallback-counter");
      yield* writeTextFile(counterFile, "0");
      const counterPath = toShPath(counterFile);
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey(
          `!sh -c 'echo 1 > "${counterPath}"; echo fallback-key'`,
        ),
      });
      yield* awaited(
        authStorage.modify("custom-provider", () =>
          effectRunPromise(
            awaited({
              key: "stored-key",
              type: "api_key",
            }),
          ),
        ),
      );

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const auth = yield* awaited(
        registry.getApiKeyAndHeaders(registry.find("custom-provider", "test-model")!),
      );

      expect(auth).toMatchObject({ apiKey: "stored-key", ok: true });
      expect((yield* readTextFile(counterFile)).trim()).toBe("0");
    }),
  );

const getapikeyandheadersPreservesTheLegacyMissingKeyAuthheader = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "custom-provider": {
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://example.test/v1",
          models: [{ id: "test-model" }],
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const auth = yield* awaited(
        registry.getApiKeyAndHeaders(registry.find("custom-provider", "test-model")!),
      );

      expect(auth).toEqual({ error: 'No API key found for "custom-provider"', ok: false });
    }),
  );

const getapikeyandheadersReturnsAnErrorForFailedAuthheader = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeRawModelsJson({
        "custom-provider": {
          ...providerWithApiKey("!exit 1"),
          authHeader: true,
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const model = registry.find("custom-provider", "test-model");
      expect(model).toBeDefined();

      const auth = yield* awaited(registry.getApiKeyAndHeaders(model!));
      expect(auth.ok).toBe(false);
      if (!auth.ok) {
        expect(auth.error).toContain('Failed to resolve API key for provider "custom-provider"');
      }
    }),
  );

const getapikeyandheadersResolvesAuthheaderOnEveryRequest = () =>
  runTest(
    Effect.gen(function* () {
      const tokenFile = joinPath(tempDir, "token");
      yield* writeTextFile(tokenFile, "token-1");
      const tokenPath = toShPath(tokenFile);

      yield* writeRawModelsJson({
        "custom-provider": {
          ...providerWithApiKey(`!sh -c 'cat "${tokenPath}"'`),
          authHeader: true,
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const model = registry.find("custom-provider", "test-model");
      expect(model).toBeDefined();

      const auth1 = yield* awaited(registry.getApiKeyAndHeaders(model!));
      expect(auth1).toEqual({
        apiKey: "token-1",
        headers: { Authorization: "Bearer token-1" },
        ok: true,
      });

      yield* writeTextFile(tokenFile, "token-2");

      const auth2 = yield* awaited(registry.getApiKeyAndHeaders(model!));
      expect(auth2).toEqual({
        apiKey: "token-2",
        headers: { Authorization: "Bearer token-2" },
        ok: true,
      });
    }),
  );

const getapikeyandheadersResolvesConfiguredAuthExactlyOnce = () =>
  runTest(
    Effect.gen(function* () {
      const counterFile = joinPath(tempDir, "auth-counter");
      yield* writeTextFile(counterFile, "0");
      const counterPath = toShPath(counterFile);
      yield* writeRawModelsJson({
        "custom-provider": {
          ...providerWithApiKey(
            `!sh -c 'count=$(cat "${counterPath}"); count=$((count + 1)); echo "$count" > "${counterPath}"; echo "token-$count"'`,
          ),
          authHeader: true,
        },
      });

      const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      const auth = yield* awaited(
        registry.getApiKeyAndHeaders(registry.find("custom-provider", "test-model")!),
      );

      expect(auth).toEqual({
        apiKey: "token-1",
        headers: { Authorization: "Bearer token-1" },
        ok: true,
      });
      expect((yield* readTextFile(counterFile)).trim()).toBe("1");
    }),
  );

const environmentVariablesAreNotCachedChangesAre = () =>
  runTest(
    Effect.gen(function* () {
      const envVarName = "TEST_API_KEY_CACHE_TEST_98765";
      const originalEnv = readEnv(envVarName);

      try {
        writeEnv(envVarName, "first-value");

        yield* writeRawModelsJson({
          "custom-provider": providerWithApiKey(`$${envVarName}`),
        });

        const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

        const key1 = yield* awaited(registry.getApiKeyForProvider("custom-provider"));
        expect(key1).toBe("first-value");

        writeEnv(envVarName, "second-value");

        const key2 = yield* awaited(registry.getApiKeyForProvider("custom-provider"));
        expect(key2).toBe("second-value");
      } finally {
        if (originalEnv === undefined) {
          deleteEnv(envVarName);
        } else {
          writeEnv(envVarName, originalEnv);
        }
      }
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
    describe("request-time resolution", () => {
      test(
        "stored credentials bypass lower-priority configured auth commands",
        storedCredentialsBypassLowerPriorityConfiguredAuth,
      );

      test(
        "getApiKeyAndHeaders preserves the legacy missing-key authHeader error",
        getapikeyandheadersPreservesTheLegacyMissingKeyAuthheader,
      );

      test(
        "getApiKeyAndHeaders returns an error for failed authHeader resolution",
        getapikeyandheadersReturnsAnErrorForFailedAuthheader,
      );
    });
  });

  test(
    "getApiKeyAndHeaders resolves authHeader on every request",
    getapikeyandheadersResolvesAuthheaderOnEveryRequest,
  );

  test(
    "getApiKeyAndHeaders resolves configured auth exactly once",
    getapikeyandheadersResolvesConfiguredAuthExactlyOnce,
  );

  test(
    "environment variables are not cached (changes are picked up)",
    environmentVariablesAreNotCachedChangesAre,
  );
});
