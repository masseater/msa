import type InMemoryModelsStoreClass from "./models-store.ts";
import type typesModule from "./types.types.ts";

declare namespace modelsStoreTypes {
  interface ModelsStoreEntry {
    models: readonly typesModule.AnyModel[];
    lastModified?: number;
    checkedAt?: number;
    etag?: string;
  }

  interface ModelsStoreOperationOptions {
    signal?: AbortSignal;
  }

  interface ModelsStore {
    read(
      providerId: string,
      options?: ModelsStoreOperationOptions,
    ): Promise<ModelsStoreEntry | undefined>;
    write(
      providerId: string,
      entry: ModelsStoreEntry,
      options?: ModelsStoreOperationOptions,
    ): Promise<void>;
    delete(providerId: string, options?: ModelsStoreOperationOptions): Promise<void>;
  }

  type InMemoryModelsStore = InMemoryModelsStoreClass;
}

export type { modelsStoreTypes as default };
