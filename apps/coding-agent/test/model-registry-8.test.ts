import type { Api } from "@msa/ai/compat";
import { getSupportedThinkingLevels } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { type ProviderConfigInput, clearApiKeyCache } from "../src/core/model-registry.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, joinPath, makeTempDir, randomSuffixSync, removePath, runTest, writeJsonFile } =
  testing;

let tempDir: string;

let modelsJsonPath: string;

let authStorage: AuthStorage;

function providerConfig(
  baseUrl: string,
  models: Array<{ id: string; name?: string }>,
  api: string = "anthropic-messages",
): ProviderConfigInput {
  return {
    api: api as Api,
    apiKey: "test-key",
    baseUrl,
    models: models.map((m) => ({
      contextWindow: 100000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: m.id,
      input: ["text"],
      maxTokens: 8000,
      name: m.name ?? m.id,
      reasoning: false,
    })),
  };
}

const writeRawModelsJson = (providers: Record<string, unknown>) =>
  writeJsonFile(modelsJsonPath, { providers });

const modeloverridesApplyToDynamicallyRegisteredProviderModelsPart1 = () =>
  writeRawModelsJson({
    "extension-provider": {
      modelOverrides: {
        "extension-model": {
          headers: { "x-model-override": "enabled" },
          name: "Overridden Extension Model",
          thinkingLevelMap: {
            low: null,
            medium: null,
            minimal: null,
            off: null,
            xhigh: "max",
          },
        },
      },
    },
  });

const modeloverridesApplyToDynamicallyRegisteredProviderModels = Effect.gen(function* () {
  yield* modeloverridesApplyToDynamicallyRegisteredProviderModelsPart1();

  const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
  registry.registerProvider("extension-provider", {
    api: "openai-completions",
    apiKey: "test-key",
    baseUrl: "https://provider.test/v1",
    models: [
      {
        contextWindow: 128000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "extension-model",
        input: ["text"],
        maxTokens: 4096,
        name: "Extension Model",
        reasoning: true,
      },
    ],
  });

  const model = registry.find("extension-provider", "extension-model");
  expect(model).toBeDefined();
  if (model === undefined) {
    throw new Error("extension model was not registered");
  }
  expect(model.name).toBe("Overridden Extension Model");
  expect(model.thinkingLevelMap).toEqual({
    low: null,
    medium: null,
    minimal: null,
    off: null,
    xhigh: "max",
  });
  expect(getSupportedThinkingLevels(model)).toEqual(["high", "xhigh"]);
  expect(yield* awaited(registry.getApiKeyAndHeaders(model))).toMatchObject({
    headers: { "x-model-override": "enabled" },
    ok: true,
  });
});

const storedApiKeyEnvPropagatesToRequest = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  yield* awaited(
    authStorage.modify("openrouter", () =>
      effectRunPromise(
        awaited({
          env: { OPENROUTER_TEAM: "stored-team" },
          key: "stored-openrouter-key",
          type: "api_key",
        }),
      ),
    ),
  );
  yield* writeRawModelsJson({
    openrouter: {
      headers: { "x-team": "$OPENROUTER_TEAM" },
    },
  });

  const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));
  const model = registry.getAll().find((m) => m.provider === "openrouter");
  expect(model).toBeDefined();

  const auth = yield* awaited(registry.getApiKeyAndHeaders(model!));

  expect(auth).toEqual({
    apiKey: "stored-openrouter-key",
    env: { OPENROUTER_TEAM: "stored-team" },
    headers: { "x-team": "stored-team" },
    ok: true,
  });
});

const registerproviderTreatsUppercaseApikeyAndHeadersAs = Effect.gen(function* () {
  for (const key of ["CUSTOM_NAME", "BEARER", "MODEL_TOKEN"]) vi.stubEnv(key, `env-${key}`);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

  registry.registerProvider("literal-provider", {
    ...providerConfig("https://provider.test/v1", [{ id: "demo-model" }], "openai-completions"),
    apiKey: "CUSTOM_NAME",
    headers: { Authorization: "BEARER" },
    models: [
      {
        contextWindow: 100000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        headers: { "x-model-token": "MODEL_TOKEN" },
        id: "demo-model",
        input: ["text"],
        maxTokens: 8000,
        name: "demo-model",
        reasoning: false,
      },
    ],
  });

  expect(yield* awaited(registry.getApiKeyForProvider("literal-provider"))).toBe("CUSTOM_NAME");
  const model = registry.find("literal-provider", "demo-model");
  expect(model).toBeDefined();
  expect(yield* awaited(registry.getApiKeyAndHeaders(model!))).toMatchObject({
    apiKey: "CUSTOM_NAME",
    headers: {
      Authorization: "BEARER",
      "x-model-token": "MODEL_TOKEN",
    },
    ok: true,
  });
  expect(warnSpy).not.toHaveBeenCalled();
});

const failedRegisterproviderDoesNotPersistInvalidStreamsimple = Effect.gen(function* () {
  const registry = yield* awaited(createModelRegistry(authStorage, modelsJsonPath));

  expect(() =>
    registry.registerProvider("broken-provider", {
      streamSimple: (() => {
        throw new Error("should not run");
      }) as any,
    }),
  ).toThrow('Provider broken-provider: "api" is required when registering streamSimple.');

  yield* awaited(expect(registry.refresh()).resolves.toMatchObject({ aborted: false }));
});

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

  describe("dynamic provider lifecycle", () => {
    test("modelOverrides apply to dynamically registered provider models", () =>
      runTest(modeloverridesApplyToDynamicallyRegisteredProviderModels));

    test("stored API key env propagates to request auth and resolves headers", () =>
      runTest(storedApiKeyEnvPropagatesToRequest));

    test("registerProvider treats uppercase apiKey and headers as literals", () =>
      runTest(registerproviderTreatsUppercaseApikeyAndHeadersAs));

    test("failed registerProvider does not persist invalid streamSimple config", () =>
      runTest(failedRegisterproviderDoesNotPersistInvalidStreamsimple));
  });
});
