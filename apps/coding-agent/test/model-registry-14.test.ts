import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { clearApiKeyCache } from "../src/core/model-registry.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";
import { Effect } from "effect";
import { deleteEnv, readEnv, writeEnv } from "../src/core/process-env.ts";
import { nodeFs } from "./model-registry-support.ts";
import { awaited, joinPath, makeTempDir, randomSuffixSync, readTextFile, removePath, runTest, writeTextFile} from "@msa/testing";

describe("ModelRegistry", () => {
  let tempDir: string;

  let modelsJsonPath: string;

  let authStorage: AuthStorage;

  function toShPath(value: string): string {
    return value.replace(/\\/ug, "/").replace(/"/ug, '\\"');
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
    describe("request-time resolution", () => {
      test("stored credentials bypass lower-priority configured auth commands", () => runTest(
Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const counterFile = joinPath(tempDir, "fallback-counter");
        (yield* writeTextFile(counterFile, "0"));
        const counterPath = toShPath(counterFile);
        writeRawModelsJson({
          "custom-provider": providerWithApiKey(
            `!sh -c 'echo 1 > "${counterPath}"; echo fallback-key'`,
          ),
        });
        (yield* awaited(authStorage.modify("custom-provider", () => effectRunPromise(awaited(({
          type: "api_key",
          key: "stored-key",
        }))))));

        const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
        const auth = (yield* awaited(registry.getApiKeyAndHeaders(
          registry.find("custom-provider", "test-model")!,
        )));

        expect(auth).toMatchObject({ ok: true, apiKey: "stored-key" });
        expect((yield* readTextFile(counterFile)).trim()).toBe("0");
      
}),
));

      test("getApiKeyAndHeaders preserves the legacy missing-key authHeader error", () => runTest(
Effect.gen(function* () {

        writeRawModelsJson({
          "custom-provider": {
            baseUrl: "https://example.test/v1",
            api: "openai-completions",
            authHeader: true,
            models: [{ id: "test-model" }],
          },
        });

        const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
        const auth = (yield* awaited(registry.getApiKeyAndHeaders(
          registry.find("custom-provider", "test-model")!,
        )));

        expect(auth).toEqual({ ok: false, error: 'No API key found for "custom-provider"' });
      
}),
));

      test("getApiKeyAndHeaders returns an error for failed authHeader resolution", () => runTest(
Effect.gen(function* () {

        writeRawModelsJson({
          "custom-provider": {
            ...providerWithApiKey("!exit 1"),
            authHeader: true,
          },
        });

        const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
        const model = registry.find("custom-provider", "test-model");
        expect(model).toBeDefined();

        const auth = (yield* awaited(registry.getApiKeyAndHeaders(model!)));
        expect(auth.ok).toBe(false);
        if (!auth.ok) {
          expect(auth.error).toContain('Failed to resolve API key for provider "custom-provider"');
        }
      
}),
));
    });
  });

      test("getApiKeyAndHeaders resolves authHeader on every request", () => runTest(
Effect.gen(function* () {

        const tokenFile = joinPath(tempDir, "token");
        (yield* writeTextFile(tokenFile, "token-1"));
        const tokenPath = toShPath(tokenFile);

        writeRawModelsJson({
          "custom-provider": {
            ...providerWithApiKey(`!sh -c 'cat "${tokenPath}"'`),
            authHeader: true,
          },
        });

        const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
        const model = registry.find("custom-provider", "test-model");
        expect(model).toBeDefined();

        const auth1 = (yield* awaited(registry.getApiKeyAndHeaders(model!)));
        expect(auth1).toEqual({
          ok: true,
          apiKey: "token-1",
          headers: { Authorization: "Bearer token-1" },
        });

        (yield* writeTextFile(tokenFile, "token-2"));

        const auth2 = (yield* awaited(registry.getApiKeyAndHeaders(model!)));
        expect(auth2).toEqual({
          ok: true,
          apiKey: "token-2",
          headers: { Authorization: "Bearer token-2" },
        });
      
}),
));

      test("getApiKeyAndHeaders resolves configured auth exactly once", () => runTest(
Effect.gen(function* () {

        const counterFile = joinPath(tempDir, "auth-counter");
        (yield* writeTextFile(counterFile, "0"));
        const counterPath = toShPath(counterFile);
        writeRawModelsJson({
          "custom-provider": {
            ...providerWithApiKey(
              `!sh -c 'count=$(cat "${counterPath}"); count=$((count + 1)); echo "$count" > "${counterPath}"; echo "token-$count"'`,
            ),
            authHeader: true,
          },
        });

        const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));
        const auth = (yield* awaited(registry.getApiKeyAndHeaders(
          registry.find("custom-provider", "test-model")!,
        )));

        expect(auth).toEqual({
          ok: true,
          apiKey: "token-1",
          headers: { Authorization: "Bearer token-1" },
        });
        expect((yield* readTextFile(counterFile)).trim()).toBe("1");
      
}),
));

      test("environment variables are not cached (changes are picked up)", () => runTest(
Effect.gen(function* () {

        const envVarName = "TEST_API_KEY_CACHE_TEST_98765";
        const originalEnv = readEnv(envVarName);

        try {
          writeEnv(envVarName, "first-value");

          writeRawModelsJson({
            "custom-provider": providerWithApiKey(`$${envVarName}`),
          });

          const registry = (yield* awaited(createModelRegistry(authStorage, modelsJsonPath)));

          const key1 = (yield* awaited(registry.getApiKeyForProvider("custom-provider")));
          expect(key1).toBe("first-value");

          writeEnv(envVarName, "second-value");

          const key2 = (yield* awaited(registry.getApiKeyForProvider("custom-provider")));
          expect(key2).toBe("second-value");
        } finally {
          if (originalEnv === undefined) {
            deleteEnv(envVarName);
          } else {
            writeEnv(envVarName, originalEnv);
          }
        }
      
}),
));
});
