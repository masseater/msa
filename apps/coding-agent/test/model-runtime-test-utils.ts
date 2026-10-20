import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { InMemoryCodingAgentModelsStore } from "../src/core/models-store.ts";

const { awaited, joinPath, runTest } = testing;

const runtimes = new WeakMap<ModelRegistry, ModelRuntime>();

function wrap(runtime: ModelRuntime): ModelRegistry {
  const registry = new ModelRegistry(runtime);
  runtimes.set(registry, runtime);
  return registry;
}

const createModelRegistry = (
  ...[credentials, modelsPath]: [credentials: aiTypes.CredentialStore, modelsPath?: string]
): Promise<ModelRegistry> =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        ModelRuntime.create({
          allowModelNetwork: false,
          credentials,
          ...(modelsPath === undefined ? {} : { modelsPath }),
          modelsStore: new InMemoryCodingAgentModelsStore(),
        }),
      );
      return wrap(runtime);
    }),
  );

const createInMemoryModelRegistry = (
  credentials: aiTypes.CredentialStore,
): Promise<ModelRegistry> =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        ModelRuntime.create({ allowModelNetwork: false, credentials, modelsPath: null }),
      );
      return wrap(runtime);
    }),
  );

function getModelRuntime(modelRegistry: ModelRegistry): ModelRuntime {
  const runtime = runtimes.get(modelRegistry);
  if (runtime === undefined) throw new Error("ModelRegistry was not created by the test helper");
  return runtime;
}

const createKeyedModelRuntime = Effect.fn("createKeyedModelRuntime")(function* (
  cwd: string,
  provider: string | undefined = "anthropic-api",
) {
  const authStorage = AuthStorage.create(joinPath(cwd, "auth.json"));
  const modelRegistry = yield* awaited(createModelRegistry(authStorage, cwd));
  if (provider !== undefined) {
    yield* awaited(
      authStorage.modify(provider, () =>
        runTest(Effect.succeed({ key: "test-key", type: "api_key" as const })),
      ),
    );
  }
  return { authStorage, modelRegistry, modelRuntime: getModelRuntime(modelRegistry) };
});

const modelRuntimeTestUtils = {
  createInMemoryModelRegistry,
  createKeyedModelRuntime,
  createModelRegistry,
  getModelRuntime,
};

export default modelRuntimeTestUtils;
