import type { AnyModel } from "./types.ts";

export interface ModelsStoreEntry {
  models: readonly AnyModel[];
  lastModified?: number;
  checkedAt?: number;
  etag?: string;
}

export interface ModelsStoreOperationOptions {
  signal?: AbortSignal;
}

export interface ModelsStore {
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

export class InMemoryModelsStore implements ModelsStore {
  private readonly entries = new Map<string, ModelsStoreEntry>();

  read(
    providerId: string,
    options?: ModelsStoreOperationOptions,
  ): Promise<ModelsStoreEntry | undefined> {
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
    entry: ModelsStoreEntry,
    options?: ModelsStoreOperationOptions,
  ): Promise<void> {
    try {
      options?.signal?.throwIfAborted();
      this.entries.set(providerId, structuredClone(entry));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  delete(providerId: string, options?: ModelsStoreOperationOptions): Promise<void> {
    try {
      options?.signal?.throwIfAborted();
      this.entries.delete(providerId);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
