import ai from "@msa/ai";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Deferred, Effect } from "effect";
import { afterEach, beforeEach, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import type authStorageTypes from "../src/core/auth-storage.types.ts";
import providerAuth from "../src/core/provider-composer/provider-auth.ts";
import type modelRegistrySupportTypes from "./model-registry-support.types.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { normalizeContext } = ai;
const { awaited, joinPath, makeTempDir, randomSuffixSync, removePath, runTest, writeJsonFile } =
  testing;
const { clearApiKeyCache } = providerAuth;
const { createModelRegistry } = modelRuntimeTestUtils;

const openAiModel: compatTypes.Model<compatTypes.Api> = {
  api: "openai-completions",
  baseUrl: "https://api.openai.com/v1",
  contextWindow: 128000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "test-openai-model",
  input: ["text"],
  maxTokens: 4096,
  name: "Test OpenAI Model",
  provider: "openai",
  reasoning: false,
};

const emptyContext = normalizeContext({
  messages: [],
});

const makeGate = (): modelRegistrySupportTypes.Gate => {
  const deferred = Deferred.makeUnsafe<void>();
  return {
    open: () => {
      Effect.runSync(Deferred.succeed(deferred, undefined));
    },
    promise: Deferred.await(deferred),
  };
};

const captureThrown = (run: () => void): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

function toShPath(value: string): string {
  return value.replace(/\\/gu, "/").replace(/"/gu, '\\"');
}

const writeRawModelsJson = (modelsJsonPath: string, providers: Record<string, unknown>) =>
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

interface ModelRegistryFixture {
  tempDir: string;
  modelsJsonPath: string;
  authStorage: authStorageTypes.AuthStorage;
  writeRawModelsJson: (providers: Record<string, unknown>) => ReturnType<typeof writeJsonFile>;
  registry: () => Effect.Effect<Awaited<ReturnType<typeof createModelRegistry>>>;
}

const useModelRegistryFixture = (): ModelRegistryFixture => {
  const fixture: ModelRegistryFixture = {
    authStorage: AuthStorage.inMemory(),
    modelsJsonPath: "",
    registry: () => awaited(createModelRegistry(fixture.authStorage, fixture.modelsJsonPath)),
    tempDir: "",
    writeRawModelsJson: (providers) => writeRawModelsJson(fixture.modelsJsonPath, providers),
  };

  beforeEach(() =>
    runTest(makeTempDir(`msa-test-model-registry-${randomSuffixSync()}-`)).then((dir) => {
      fixture.tempDir = dir;
      fixture.modelsJsonPath = joinPath(dir, "models.json");
      fixture.authStorage = AuthStorage.inMemory();
      return dir;
    }),
  );

  afterEach(() => {
    clearApiKeyCache();
    vi.restoreAllMocks();
    return runTest(removePath(fixture.tempDir));
  });

  return fixture;
};

const modelRegistrySupport = {
  captureThrown,
  emptyContext,
  makeGate,
  openAiModel,
  providerWithApiKey,
  toShPath,
  useModelRegistryFixture,
  writeRawModelsJson,
};

export default modelRegistrySupport;
