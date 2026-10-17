import type { Effect } from "effect";

import { defaultProviderAuthContext } from "../auth/context.ts";
import { InMemoryCredentialStore } from "../auth/credential-store.ts";
import type { AuthContext, Credential, CredentialStore } from "../auth/types.ts";
import { InMemoryModelsStore, type ModelsStore, type ModelsStoreEntry } from "../models-store.ts";
import type { AnyModel, ModelType, ProviderHeaders } from "../types.ts";
import { getModelType } from "../utils/model-operations.ts";
import { promiseOrModelsError } from "../utils/models-error.ts";
import type { Provider } from "./provider-types.ts";
import type { CreateModelsOptions } from "./types.ts";

export interface ModelsState {
  readonly providers: Map<string, Provider>;
  readonly credentials: CredentialStore;
  readonly modelsStore: ModelsStore;
  readonly authContext: AuthContext;
  readonly refreshGenerations: Map<string, number>;
  readonly refreshControllers: Map<string, AbortController>;
  readonly publicationChains: Map<string, Promise<unknown>>;
}

export const createModelsState = (options?: CreateModelsOptions): ModelsState => ({
  providers: new Map(),
  credentials: options?.credentials ?? new InMemoryCredentialStore(),
  modelsStore: options?.modelsStore ?? new InMemoryModelsStore(),
  authContext: options?.authContext ?? defaultProviderAuthContext(),
  refreshGenerations: new Map(),
  refreshControllers: new Map(),
  publicationChains: new Map(),
});

const KNOWN_MODEL_TYPES: Record<ModelType, true> = { chat: true, image: true, classifier: true };

export const hasKnownModelType = (model: AnyModel): boolean =>
  Object.hasOwn(KNOWN_MODEL_TYPES, getModelType(model));

export const withKnownModelTypes = (entry: ModelsStoreEntry): ModelsStoreEntry => ({
  ...entry,
  models: entry.models.filter(hasKnownModelType),
});

export interface HeaderLayers {
  readonly base: ProviderHeaders | undefined;
  readonly override: ProviderHeaders | undefined;
}

export const mergeHeaders = ({ base, override }: HeaderLayers): ProviderHeaders | undefined => {
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

export interface CredentialRead {
  readonly state: ModelsState;
  readonly providerId: string;
  readonly signal: AbortSignal;
}

export const readCredential = ({
  state,
  providerId,
  signal,
}: CredentialRead): Effect.Effect<Credential | undefined> =>
  promiseOrModelsError(() => state.credentials.read(providerId, { signal }), {
    code: "auth",
    message: `Credential store read failed for ${providerId}`,
  });
