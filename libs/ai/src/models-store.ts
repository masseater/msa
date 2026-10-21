import type modelsStoreTypes from "./models-store.types.ts";

export default class InMemoryModelsStore implements modelsStoreTypes.ModelsStore {
  private readonly entries = new Map<string, modelsStoreTypes.ModelsStoreEntry>();

  read(
    providerId: string,
    options?: modelsStoreTypes.ModelsStoreOperationOptions,
  ): Promise<modelsStoreTypes.ModelsStoreEntry | undefined> {
    try {
      options?.signal?.throwIfAborted();
      const entry = this.entries.get(providerId);
      return Promise.resolve(entry === undefined ? undefined : structuredClone(entry));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  write(
    providerId: string,
    entry: modelsStoreTypes.ModelsStoreEntry,
    options?: modelsStoreTypes.ModelsStoreOperationOptions,
  ): Promise<void> {
    try {
      options?.signal?.throwIfAborted();
      this.entries.set(providerId, structuredClone(entry));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  delete(
    providerId: string,
    options?: modelsStoreTypes.ModelsStoreOperationOptions,
  ): Promise<void> {
    try {
      options?.signal?.throwIfAborted();
      this.entries.delete(providerId);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
