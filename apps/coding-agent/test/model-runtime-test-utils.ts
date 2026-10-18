import type { CredentialStore } from "@msa/ai";
import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { ModelRegistry } from "../src/core/model-registry.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { InMemoryCodingAgentModelsStore } from "../src/core/models-store.ts";

const runtimes = new WeakMap<ModelRegistry, ModelRuntime>();

const wrap = (runtime: ModelRuntime): ModelRegistry => {
  const registry = new ModelRegistry(runtime);
  runtimes.set(registry, runtime);
  return registry;
};

export const createModelRegistry: {
  (credentials: CredentialStore, modelsPath?: string): Promise<ModelRegistry>;
  (modelsPath?: string): (credentials: CredentialStore) => Promise<ModelRegistry>;
} = dual(
  () => true,
  (credentials: CredentialStore, modelsPath?: string): Promise<ModelRegistry> =>
    runTest(
      Effect.gen(function* () {
        return wrap(
          yield* awaited(
            ModelRuntime.create({
              credentials,
              ...(modelsPath === undefined ? {} : { modelsPath }),
              modelsStore: new InMemoryCodingAgentModelsStore(),
              allowModelNetwork: false,
            }),
          ),
        );
      }),
    ),
);

export const createInMemoryModelRegistry = (credentials: CredentialStore): Promise<ModelRegistry> =>
  runTest(
    Effect.gen(function* () {
      return wrap(
        yield* awaited(
          ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false }),
        ),
      );
    }),
  );

export const getModelRuntime = (modelRegistry: ModelRegistry): ModelRuntime => {
  const runtime = runtimes.get(modelRegistry);
  if (runtime === undefined) throw new Error("ModelRegistry was not created by the test helper");
  return runtime;
};
