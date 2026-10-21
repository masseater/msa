import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import ModelConfig from "../src/core/model-config.ts";
import type codingAgentTypes from "../src/index.types.ts";
import modelRegistryFixture from "./model-registry-fixture.ts";
import modelRegistrySupport from "./model-registry-support.ts";

const { createProvider } = ai;

const { makeGate } = modelRegistrySupport;
const { useModelRegistryFixture } = modelRegistryFixture;

const { awaited, joinPath, readTextFile, runTest, writeJsonFile, writeTextFile } = testing;

const fixture = useModelRegistryFixture();

function toShPath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/"/gu, '\\"');
}

const writeRawModelsJson = (providers: Record<string, unknown>) =>
  writeJsonFile(fixture.modelsJsonPath, { providers });

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

const filteredChatModel = (id: string): compatTypes.Model<"openai-completions"> => ({
  api: "openai-completions",
  baseUrl: "https://provider.test/v1",
  contextWindow: 1000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id,
  input: ["text"],
  maxTokens: 100,
  name: id,
  provider: "filtered-provider",
  reasoning: false,
});

const createLimitedKeyRegistry = (): Promise<codingAgentTypes.ModelRegistry> =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      yield* awaited(
        fixture.authStorage.modify("filtered-provider", () =>
          effectRunPromise(
            awaited({
              key: "limited-key",
              type: "api_key",
            }),
          ),
        ),
      );
      return yield* awaited(fixture.createRegistry());
    }),
  );

const registerFilteredProvider = (
  registry: codingAgentTypes.ModelRegistry,
  onResolve: () => void,
): void => {
  registry.registerProvider(
    createProvider({
      api: {
        stream: () => {
          throw new Error("not used");
        },
        streamSimple: () => {
          throw new Error("not used");
        },
      },
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
      filterModels: (models, credential) =>
        credential?.type === "api_key" && credential.key === "limited-key"
          ? models.filter((m) => m.id === "allowed")
          : models,
      id: "filtered-provider",
      models: [filteredChatModel("allowed"), filteredChatModel("denied")],
    }),
  );
};

const filteredAvailableIds = (registry: codingAgentTypes.ModelRegistry): string[] =>
  registry
    .getAvailable()
    .filter((m) => m.provider === "filtered-provider")
    .map((m) => m.id);

const providerAuthStatusReportsCommandApikeyValues = () =>
  runTest(
    Effect.gen(function* () {
      const counterFile = joinPath(fixture.tempDir, "status-counter");
      yield* writeTextFile(counterFile, "0");
      const counterPath = toShPath(counterFile);
      const command = `!sh -c 'echo 1 > "${counterPath}"; echo key-value'`;
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey(command),
      });

      const registry = yield* awaited(fixture.createRegistry());

      expect(registry.getProviderAuthStatus("custom-provider")).toEqual({
        configured: true,
        source: "models_json_command",
      });
      expect(yield* readTextFile(counterFile)).toBe("0");
    }),
  );

const getavailableDoesNotExecuteCommandBackedApikey = () =>
  runTest(
    Effect.gen(function* () {
      const counterFile = joinPath(fixture.tempDir, "counter");
      yield* writeTextFile(counterFile, "0");

      const counterPath = toShPath(counterFile);
      const command = `!sh -c 'count=$(cat "${counterPath}"); echo $((count + 1)) > "${counterPath}"; echo "key-value"'`;
      yield* writeRawModelsJson({
        "custom-provider": providerWithApiKey(command),
      });

      const registry = yield* awaited(fixture.createRegistry());
      const available = registry.getAvailable();

      expect(available.some((m) => m.provider === "custom-provider")).toBe(true);
      const count = parseInt((yield* readTextFile(counterFile)).trim(), 10);
      expect(count).toBe(0);
    }),
  );

const getavailableAppliesTheProviderSCredentialSpecific = () =>
  runTest(
    Effect.gen(function* () {
      const registry = yield* awaited(createLimitedKeyRegistry());
      registerFilteredProvider(registry, () => {});
      yield* awaited(registry.refresh());

      expect(filteredAvailableIds(registry)).toEqual(["allowed"]);
    }),
  );

const aBackgroundRefreshThatLandsDuringAn = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const config = yield* awaited(ModelConfig.load(fixture.modelsJsonPath));
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
  );

describe("ModelRegistry", () => {
  describe("API key resolution", () => {
    describe("request-time resolution", () => {
      test(
        "provider auth status reports command apiKey values from models.json without executing them",
        providerAuthStatusReportsCommandApikeyValues,
      );

      test(
        "getAvailable does not execute command-backed apiKey resolution",
        getavailableDoesNotExecuteCommandBackedApikey,
      );

      test(
        "getAvailable applies the provider's credential-specific filterModels",
        getavailableAppliesTheProviderSCredentialSpecific,
      );

      test(
        "a background refresh that lands during an awaited refresh keeps filterModels",
        aBackgroundRefreshThatLandsDuringAn,
      );
    });
  });
});
