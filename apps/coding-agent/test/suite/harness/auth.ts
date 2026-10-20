import type { FauxModelDefinition, FauxProviderRegistration, Model } from "@msa/ai/compat";
import { registerFauxProvider } from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";

import { AuthStorage } from "../../../src/core/auth-storage.ts";
import type { ModelRegistry } from "../../../src/core/model-registry.ts";
import modelRuntimeTestUtils from "../../model-runtime-test-utils.ts";

const { createInMemoryModelRegistry, createModelRegistry } = modelRuntimeTestUtils;

const { joinPath, toJsonText, writeTextFile } = testing;

function createFauxProvider(models: FauxModelDefinition[] | undefined): FauxProviderRegistration {
  const provider: FauxProviderRegistration = registerFauxProvider(
    models === undefined ? {} : { models },
  );
  provider.setResponses([]);
  return provider;
}

function createAuthStorage(entry: {
  provider: string;
  withConfiguredAuth: boolean;
}): Promise<AuthStorage> {
  const authStorage = AuthStorage.inMemory();
  if (!entry.withConfiguredAuth) return Promise.resolve(authStorage);
  return authStorage
    .modify(entry.provider, () => Promise.resolve({ key: "faux-key", type: "api_key" }))
    .then(() => authStorage);
}

function writeModelsJson(entry: {
  modelsPath: string;
  modelsJson: Record<string, unknown>;
}): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* writeTextFile(entry.modelsPath, yield* toJsonText(entry.modelsJson));
    }),
  );
}

function registerFauxModels(entry: {
  modelRegistry: ModelRegistry;
  model: Model<string>;
  fauxProvider: FauxProviderRegistration;
}): void {
  const { modelRegistry, model, fauxProvider } = entry;
  modelRegistry.registerProvider(model.provider, {
    api: fauxProvider.api,
    apiKey: "faux-key",
    baseUrl: model.baseUrl,
    models: fauxProvider.models.map((registeredModel) =>
      Object.assign({}, registeredModel, { baseUrl: registeredModel.baseUrl }),
    ),
  });
}

function createRegistry(entry: {
  authStorage: AuthStorage;
  modelsPath: string | undefined;
}): Promise<ModelRegistry> {
  return entry.modelsPath === undefined || entry.modelsPath === ""
    ? createInMemoryModelRegistry(entry.authStorage)
    : createModelRegistry(entry.authStorage, entry.modelsPath);
}

function modelsPathFor(entry: {
  tempDir: string;
  modelsJson: Record<string, unknown> | undefined;
}): string | undefined {
  return entry.modelsJson === undefined ? undefined : joinPath(entry.tempDir, "models.json");
}

const auth = {
  createAuthStorage,
  createFauxProvider,
  createRegistry,
  modelsPathFor,
  registerFauxModels,
  writeModelsJson,
};

export default auth;
