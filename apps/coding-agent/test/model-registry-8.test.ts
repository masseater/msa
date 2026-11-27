import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import modelRegistry4Support from "./model-registry-4-support.ts";
import modelRegistrySupport from "./model-registry-support.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { useModelRegistryFixture } = modelRegistrySupport;

const fixture = useModelRegistryFixture();

const { providerConfig } = modelRegistry4Support;

const { getSupportedThinkingLevels } = compat;

const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, runTest } = testing;

const writeExtensionModelOverride = () =>
  fixture.writeRawModelsJson({
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
  yield* writeExtensionModelOverride();

  const registry = yield* awaited(createModelRegistry(fixture.authStorage, fixture.modelsJsonPath));
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
    fixture.authStorage.modify("openrouter", () =>
      effectRunPromise(
        awaited({
          env: { OPENROUTER_TEAM: "stored-team" },
          key: "stored-openrouter-key",
          type: "api_key",
        }),
      ),
    ),
  );
  yield* fixture.writeRawModelsJson({
    openrouter: {
      headers: { "x-team": "$OPENROUTER_TEAM" },
    },
  });

  const registry = yield* awaited(createModelRegistry(fixture.authStorage, fixture.modelsJsonPath));
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

  const registry = yield* awaited(createModelRegistry(fixture.authStorage, fixture.modelsJsonPath));

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
  const registry = yield* awaited(createModelRegistry(fixture.authStorage, fixture.modelsJsonPath));

  expect(() =>
    registry.registerProvider("broken-provider", {
      streamSimple: (() => {
        throw new Error("should not run");
      }) as any,
    }),
  ).toThrow('Provider broken-provider: "api" is required when registering streamSimple.');

  yield* awaited(expect(registry.refresh()).resolves.toMatchObject({ aborted: false }));
});

describe("ModelRegistry", () => {
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
