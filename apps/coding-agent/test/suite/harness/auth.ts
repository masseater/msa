import type { FauxModelDefinition, FauxProviderRegistration, Model } from "@msa/ai/compat";
import { registerFauxProvider } from "@msa/ai/compat";
import { joinPath, toJsonText, writeTextFile } from "@msa/testing";
import { Effect } from "effect";

import { AuthStorage } from "../../../src/core/auth-storage.ts";
import type { ModelRegistry } from "../../../src/core/model-registry.ts";
import {
  createInMemoryModelRegistry,
  createModelRegistry,
} from "../../model-runtime-test-utils.ts";

export function createFauxProvider(
  models: FauxModelDefinition[] | undefined,
): FauxProviderRegistration {
  const provider: FauxProviderRegistration = registerFauxProvider(
    models === undefined ? {} : { models },
  );
  provider.setResponses([]);
  return provider;
}

export function createAuthStorage(entry: {
  provider: string;
  withConfiguredAuth: boolean;
}): Promise<AuthStorage> {
  const authStorage = AuthStorage.inMemory();
  if (!entry.withConfiguredAuth) return Promise.resolve(authStorage);
  return authStorage
    .modify(entry.provider, () => Promise.resolve({ type: "api_key", key: "faux-key" }))
    .then(() => authStorage);
}

export function writeModelsJson(entry: {
  modelsPath: string;
  modelsJson: Record<string, unknown>;
}): Promise<void> {
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* writeTextFile(entry.modelsPath, yield* toJsonText(entry.modelsJson));
    }),
  );
}

export function registerFauxModels(entry: {
  modelRegistry: ModelRegistry;
  model: Model<string>;
  fauxProvider: FauxProviderRegistration;
}): void {
  const { modelRegistry, model, fauxProvider } = entry;
  modelRegistry.registerProvider(model.provider, {
    baseUrl: model.baseUrl,
    apiKey: "faux-key",
    api: fauxProvider.api,
    models: fauxProvider.models.map((registeredModel) =>
      Object.assign({}, registeredModel, { baseUrl: registeredModel.baseUrl }),
    ),
  });
}

export function createRegistry(entry: {
  authStorage: AuthStorage;
  modelsPath: string | undefined;
}): Promise<ModelRegistry> {
  return entry.modelsPath === undefined || entry.modelsPath === ""
    ? createInMemoryModelRegistry(entry.authStorage)
    : createModelRegistry(entry.authStorage, entry.modelsPath);
}

export function modelsPathFor(entry: {
  tempDir: string;
  modelsJson: Record<string, unknown> | undefined;
}): string | undefined {
  return entry.modelsJson === undefined ? undefined : joinPath(entry.tempDir, "models.json");
}
