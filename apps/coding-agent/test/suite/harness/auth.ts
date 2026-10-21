import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";
import testing from "@msa/testing";
import { Effect } from "effect";

import AuthStorage from "../../../src/core/auth-storage.ts";
import type authStorageTypes from "../../../src/core/auth-storage.types.ts";
import type modelRegistryTypes from "../../../src/core/model-registry.types.ts";
import modelRuntimeTestUtils from "../../model-runtime-test-utils.ts";
const { registerFauxProvider } = compat;

const { createInMemoryModelRegistry, createModelRegistry } = modelRuntimeTestUtils;

const { joinPath, toJsonText, writeTextFile } = testing;

function createFauxProvider(
  models: compatTypes.FauxModelDefinition[] | undefined,
): compatTypes.FauxProviderRegistration {
  const provider: compatTypes.FauxProviderRegistration = registerFauxProvider(
    models === undefined ? {} : { models },
  );
  provider.setResponses([]);
  return provider;
}

function createAuthStorage(entry: {
  provider: string;
  withConfiguredAuth: boolean;
}): Promise<authStorageTypes.AuthStorage> {
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
  modelRegistry: modelRegistryTypes.ModelRegistry;
  model: compatTypes.Model<string>;
  fauxProvider: compatTypes.FauxProviderRegistration;
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
  authStorage: authStorageTypes.AuthStorage;
  modelsPath: string | undefined;
}): Promise<modelRegistryTypes.ModelRegistry> {
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
