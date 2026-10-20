import type typesModule from "./auth/types.ts";
import type modelsStoreTypes from "./models-store.types.ts";
import type providerTypesModule from "./models/provider-types.ts";

declare namespace modelsStateTypes {
  interface ModelsState {
    readonly providers: Map<string, providerTypesModule.Provider>;
    readonly credentials: typesModule.CredentialStore;
    readonly modelsStore: modelsStoreTypes.ModelsStore;
    readonly authContext: typesModule.AuthContext;
    readonly refreshGenerations: Map<string, number>;
    readonly refreshControllers: Map<string, AbortController>;
    readonly publicationChains: Map<string, Promise<unknown>>;
  }
}

export type { modelsStateTypes as default };
