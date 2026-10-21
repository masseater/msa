import { Effect } from "effect";

import type typesModule from "./auth/types.ts";
import modelsKit from "./models-kit.ts";
import type modelsStateTypes from "./models-state.types.ts";
import type modelsStoreTypes from "./models-store.types.ts";
import type typesModuleModule2 from "./types.types.ts";

const { modelOperations, modelsError } = modelsKit;
const { getModelType } = modelOperations;
const { promiseOrModelsError } = modelsError;

const KNOWN_MODEL_TYPES: Record<typesModuleModule2.ModelType, true> = {
  chat: true,
  classifier: true,
  image: true,
};

const hasKnownModelType = (model: typesModuleModule2.AnyModel): boolean =>
  Object.hasOwn(KNOWN_MODEL_TYPES, getModelType(model));

const withKnownModelTypes = (
  entry: modelsStoreTypes.ModelsStoreEntry,
): modelsStoreTypes.ModelsStoreEntry => ({
  ...entry,
  models: entry.models.filter(hasKnownModelType),
});

interface HeaderLayers {
  readonly base: typesModuleModule2.ProviderHeaders | undefined;
  readonly override: typesModuleModule2.ProviderHeaders | undefined;
}

const mergeHeaders = ({
  base,
  override,
}: HeaderLayers): typesModuleModule2.ProviderHeaders | undefined => {
  if (base === undefined && override === undefined) return undefined;
  const merged = { ...base };
  for (const [name, value] of Object.entries(override ?? {})) {
    const lowerName = name.toLowerCase();
    for (const existingName of Object.keys(merged)) {
      if (existingName.toLowerCase() === lowerName) delete merged[existingName];
    }
    merged[name] = value;
  }
  return merged;
};

interface CredentialRead {
  readonly state: modelsStateTypes.ModelsState;
  readonly providerId: string;
  readonly signal: AbortSignal;
}

const readCredential = ({
  state,
  providerId,
  signal,
}: CredentialRead): Effect.Effect<typesModule.Credential | undefined> =>
  promiseOrModelsError(() => state.credentials.read(providerId, { signal }), {
    code: "auth",
    message: `Credential store read failed for ${providerId}`,
  });

const modelsShared = {
  KNOWN_MODEL_TYPES,
  hasKnownModelType,
  mergeHeaders,
  readCredential,
  withKnownModelTypes,
};

export default modelsShared;
