import type { CredentialStore } from "@msa/ai";
import { awaited, runTest } from "@msa/testing";
import { Effect } from "effect";

import { ModelRegistry } from "../src/core/model-registry.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { InMemoryCodingAgentModelsStore } from "../src/core/models-store.ts";

const runtimes = new WeakMap<ModelRegistry, ModelRuntime>();

function wrap(runtime: ModelRuntime): ModelRegistry {
  const registry = new ModelRegistry(runtime);
  runtimes.set(registry, runtime);
  return registry;
}

export const createModelRegistry = (
  ...[credentials, modelsPath]: [credentials: CredentialStore, modelsPath?: string]
): Promise<ModelRegistry> =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        ModelRuntime.create({
          credentials,
          ...(modelsPath === undefined ? {} : { modelsPath }),
          modelsStore: new InMemoryCodingAgentModelsStore(),
          allowModelNetwork: false,
        }),
      );
      return wrap(runtime);
    }),
  );

export const createInMemoryModelRegistry = (credentials: CredentialStore): Promise<ModelRegistry> =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false }),
      );
      return wrap(runtime);
    }),
  );

export function getModelRuntime(modelRegistry: ModelRegistry): ModelRuntime {
  const runtime = runtimes.get(modelRegistry);
  if (runtime === undefined) throw new Error("ModelRegistry was not created by the test helper");
  return runtime;
}
