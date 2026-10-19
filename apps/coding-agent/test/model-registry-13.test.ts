import { createProvider } from "@msa/ai";
import type { Model } from "@msa/ai/compat";
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
import { ModelConfig } from "../src/core/model-config.ts";
import { clearApiKeyCache, type ModelRegistry } from "../src/core/model-registry.ts";
import { nodeFs, makeGate } from "./model-registry-support.ts";
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

  const createLimitedKeyRegistry = (): Promise<ModelRegistry> =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* awaited(
          authStorage.modify("filtered-provider", () =>
            effectRunPromise(
              awaited({
                type: "api_key",
                key: "limited-key",
              }),
            ),
          ),
        );
        return yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
      }),
    );

  const registerFilteredProvider = (registry: ModelRegistry, onResolve: () => void): void => {
    registry.registerProvider(
      createProvider({
        id: "filtered-provider",
        auth: {
          apiKey: {
            name: "Filtered",
            resolve: ({ credential }) =>
              runTest(
                Effect.gen(function* () {
                  onResolve();
                  return yield* awaited(
                    credential?.key === undefined || credential.key === ""
                      ? undefined
                      : { auth: { apiKey: credential.key } },
                  );
                }),
              ),
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
      test("provider auth status reports command apiKey values from models.json without executing them", () =>
        runTest(
          Effect.gen(function* () {
            const counterFile = joinPath(tempDir, "status-counter");
            yield* writeTextFile(counterFile, "0");
            const counterPath = toShPath(counterFile);
            const command = `!sh -c 'echo 1 > "${counterPath}"; echo key-value'`;
            writeRawModelsJson({
              "custom-provider": providerWithApiKey(command),
            });

            const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

            expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
              configured: true,
              source: "models_json_command",
            });
            expect(yield* readTextFile(counterFile)).toBe("0");
          }),
        ));

      test("getAvailable does not execute command-backed apiKey resolution", () =>
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
            const available = registry.getAvailable();

            expect(available.some((m) => m.provider === "custom-provider")).toBe(true);
            const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
            expect(count).toBe(0);
          }),
        ));

      test("getAvailable applies the provider's credential-specific filterModels", () =>
        runTest(
          Effect.gen(function* () {
            const registry = yield* awaited(createLimitedKeyRegistry());
            registerFilteredProvider(registry, () => {});
            yield* awaited(registry.refresh());

            expect(filteredAvailableIds(registry)).toEqual(["allowed"]);
          }),
        ));

      test("a background refresh that lands during an awaited refresh keeps filterModels", () =>
        runTest(
          Effect.gen(function* () {
            const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            const config = yield* awaited(ModelConfig.load(modelsJsonPath));
            const background = makeGate();
            const releaseBackground = () => {
              background.open();
            };
            const registry = yield* awaited(createLimitedKeyRegistry());
            vi.spyOn(ModelConfig, "load")
              .mockImplementationOnce(() =>
                effectRunPromise(
                  Effect.gen(function* () {
                    yield* background.promise;
                    return yield* awaited(config);
                  }),
                ),
              )
              .mockImplementationOnce(() => effectRunPromise(awaited(config)));
            registerFilteredProvider(registry, () => releaseBackground());
            yield* awaited(registry.refresh());

            expect(filteredAvailableIds(registry)).toEqual(["allowed"]);
          }),
        ));
    });
  });
});
