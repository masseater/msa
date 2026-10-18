import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProvider } from "@msa/ai";
import { Model } from "@msa/ai/compat";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelConfig } from "../src/core/model-config.ts";
import { clearApiKeyCache, type ModelRegistry } from "../src/core/model-registry.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";

describe("ModelRegistry", () => {
  let tempDir: string;

  let modelsJsonPath: string;

  let authStorage: AuthStorage;

  function toShPath(value: string): string {
    return value.replace(/\\/g, "/").replace(/"/g, '\\"');
  }

  function writeRawModelsJson(providers: Record<string, unknown>) {
    writeFileSync(modelsJsonPath, JSON.stringify({ providers }));
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

  const filteredChatModel = (id: string): Model<"openai-completions"> => ({
    id,
    name: id,
    api: "openai-completions",
    provider: "filtered-provider",
    baseUrl: "https://provider.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  });

  const createLimitedKeyRegistry = async (): Promise<ModelRegistry> => {
    await authStorage.modify("filtered-provider", async () => ({
      type: "api_key",
      key: "limited-key",
    }));
    return createModelRegistry(authStorage, modelsJsonPath);
  };

  const registerFilteredProvider = (registry: ModelRegistry, onResolve: () => void): void => {
    registry.registerProvider(
      createProvider({
        id: "filtered-provider",
        auth: {
          apiKey: {
            name: "Filtered",
            resolve: async ({ credential }) => {
              onResolve();
              return credential?.key ? { auth: { apiKey: credential.key } } : undefined;
            },
          },
        },
        models: [filteredChatModel("allowed"), filteredChatModel("denied")],
        filterModels: (models, credential) =>
          credential?.type === "api_key" && credential.key === "limited-key"
            ? models.filter((m) => m.id === "allowed")
            : models,
        api: {
          stream: () => {
            throw new Error("not used");
          },
          streamSimple: () => {
            throw new Error("not used");
          },
        },
      }),
    );
  };

  const filteredAvailableIds = (registry: ModelRegistry): string[] =>
    registry
      .getAvailable()
      .filter((m) => m.provider === "filtered-provider")
      .map((m) => m.id);

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `msa-test-model-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tempDir, { recursive: true });
    modelsJsonPath = join(tempDir, "models.json");
    authStorage = AuthStorage.inMemory();
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true });
    }
    clearApiKeyCache();
    vi.restoreAllMocks();
  });

  describe("API key resolution", () => {
    describe("request-time resolution", () => {
      test("provider auth status reports command apiKey values from models.json without executing them", async () => {
        const counterFile = join(tempDir, "status-counter");
        writeFileSync(counterFile, "0");
        const counterPath = toShPath(counterFile);
        const command = `!sh -c 'echo 1 > "${counterPath}"; echo key-value'`;
        writeRawModelsJson({
          "custom-provider": providerWithApiKey(command),
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);

        expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
          configured: true,
          source: "models_json_command",
        });
        expect(readFileSync(counterFile, "utf-8")).toBe("0");
      });

      test("environment variables are not cached (changes are picked up)", async () => {
        const envVarName = "TEST_API_KEY_CACHE_TEST_98765";
        const originalEnv = process.env[envVarName];

        try {
          process.env[envVarName] = "first-value";

          writeRawModelsJson({
            "custom-provider": providerWithApiKey(`$${envVarName}`),
          });

          const registry = await createModelRegistry(authStorage, modelsJsonPath);

          const key1 = await registry.getApiKeyForProvider("custom-provider");
          expect(key1).toBe("first-value");

          process.env[envVarName] = "second-value";

          const key2 = await registry.getApiKeyForProvider("custom-provider");
          expect(key2).toBe("second-value");
        } finally {
          if (originalEnv === undefined) {
            delete process.env[envVarName];
          } else {
            process.env[envVarName] = originalEnv;
          }
        }
      });

      test("getAvailable does not execute command-backed apiKey resolution", async () => {
        const counterFile = join(tempDir, "counter");
        writeFileSync(counterFile, "0");

        const counterPath = toShPath(counterFile);
        const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
        writeRawModelsJson({
          "custom-provider": providerWithApiKey(command),
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        const available = registry.getAvailable();

        expect(available.some((m) => m.provider === "custom-provider")).toBe(true);
        const count = parseInt(readFileSync(counterFile, "utf-8").trim(), 10);
        expect(count).toBe(0);
      });

      test("getAvailable applies the provider's credential-specific filterModels", async () => {
        const registry = await createLimitedKeyRegistry();
        registerFilteredProvider(registry, () => {});
        await registry.refresh();

        expect(filteredAvailableIds(registry)).toEqual(["allowed"]);
      });

      test("a background refresh that lands during an awaited refresh keeps filterModels", async () => {
        const config = await ModelConfig.load(modelsJsonPath);
        let releaseBackground: () => void = () => {};
        const background = new Promise<void>((resolve) => {
          releaseBackground = resolve;
        });
        const registry = await createLimitedKeyRegistry();
        vi.spyOn(ModelConfig, "load")
          .mockImplementationOnce(async () => {
            await background;
            return config;
          })
          .mockImplementationOnce(async () => config);
        registerFilteredProvider(registry, () => releaseBackground());
        await registry.refresh();

        expect(filteredAvailableIds(registry)).toEqual(["allowed"]);
      });

      test("getApiKeyAndHeaders resolves authHeader on every request", async () => {
        const tokenFile = join(tempDir, "token");
        writeFileSync(tokenFile, "token-1");
        const tokenPath = toShPath(tokenFile);

        writeRawModelsJson({
          "custom-provider": {
            ...providerWithApiKey(`!sh -c 'cat "${tokenPath}"'`),
            authHeader: true,
          },
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        const model = registry.find("custom-provider", "test-model");
        expect(model).toBeDefined();

        const auth1 = await registry.getApiKeyAndHeaders(model!);
        expect(auth1).toEqual({
          ok: true,
          apiKey: "token-1",
          headers: { Authorization: "Bearer token-1" },
        });

        writeFileSync(tokenFile, "token-2");

        const auth2 = await registry.getApiKeyAndHeaders(model!);
        expect(auth2).toEqual({
          ok: true,
          apiKey: "token-2",
          headers: { Authorization: "Bearer token-2" },
        });
      });

      test("getApiKeyAndHeaders resolves configured auth exactly once", async () => {
        const counterFile = join(tempDir, "auth-counter");
        writeFileSync(counterFile, "0");
        const counterPath = toShPath(counterFile);
        writeRawModelsJson({
          "custom-provider": {
            ...providerWithApiKey(
              `!sh -c 'count=$(cat "${counterPath}"); count=$((count + 1)); echo "$count" > "${counterPath}"; echo "token-$count"'`,
            ),
            authHeader: true,
          },
        });

        const registry = await createModelRegistry(authStorage, modelsJsonPath);
        const auth = await registry.getApiKeyAndHeaders(
          registry.find("custom-provider", "test-model")!,
        );

        expect(auth).toEqual({
          ok: true,
          apiKey: "token-1",
          headers: { Authorization: "Bearer token-1" },
        });
        expect(readFileSync(counterFile, "utf-8").trim()).toBe("1");
      });
    });
  });
});
