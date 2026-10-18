import type { CredentialStore } from "@msa/ai";
import { Effect, Function } from "effect";

import { ModelRegistry } from "../src/core/model-registry.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { InMemoryCodingAgentModelsStore } from "../src/core/models-store.ts";

const runtimes = new WeakMap<ModelRegistry, ModelRuntime>();

function wrap(runtime: ModelRuntime): ModelRegistry {
  const registry = new ModelRegistry(runtime);
  runtimes.set(registry, runtime);
  return registry;
}

const createModelRegistryImpl = (
  credentials: CredentialStore,
  modelsPath?: string,
): Promise<ModelRegistry> =>
  Effect.runPromise(
    Effect.gen(function* () {
      return wrap(
        yield* Effect.promise(() =>
          ModelRuntime.create({
            credentials,
            ...(modelsPath === undefined ? {} : { modelsPath }),
            modelsStore: new InMemoryCodingAgentModelsStore(),
            allowModelNetwork: false,
          }),
        ),
      );
    }),
  );

export const createModelRegistry: {
  (modelsPath?: string): (credentials: CredentialStore) => Promise<ModelRegistry>;
  (credentials: CredentialStore, modelsPath?: string): Promise<ModelRegistry>;
} = Function.dual(
  (args) => args.length >= 2 || typeof args[0] !== "string",
  createModelRegistryImpl,
);

export function createInMemoryModelRegistry(credentials: CredentialStore): Promise<ModelRegistry> {
  return Effect.runPromise(
    Effect.gen(function* () {
      return wrap(
        yield* Effect.promise(() =>
          ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false }),
        ),
      );
    }),
  );
}

export function getModelRuntime(modelRegistry: ModelRegistry): ModelRuntime {
  const runtime = runtimes.get(modelRegistry);
  if (runtime === undefined) throw new Error("ModelRegistry was not created by the test helper");
  return runtime;
}
