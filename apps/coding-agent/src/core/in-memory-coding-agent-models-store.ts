import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

export default class InMemoryCodingAgentModelsStore implements aiTypes.ModelsStore {
  private readonly entries = new Map<string, aiTypes.ModelsStoreEntry>();

  read(
    providerId: string,
    options?: aiTypes.ModelsStoreOperationOptions,
  ): Promise<aiTypes.ModelsStoreEntry | undefined> {
    return Effect.runPromise(
      Effect.sync(() => {
        options?.signal?.throwIfAborted();
        const entry = this.entries.get(providerId);
        return entry === undefined ? undefined : structuredClone(entry);
      }),
    );
  }

  write(
    providerId: string,
    entry: aiTypes.ModelsStoreEntry,
    options?: aiTypes.ModelsStoreOperationOptions,
  ): Promise<void> {
    return Effect.runPromise(
      Effect.sync(() => {
        options?.signal?.throwIfAborted();
        this.entries.set(providerId, structuredClone(entry));
      }),
    );
  }

  delete(providerId: string, options?: aiTypes.ModelsStoreOperationOptions): Promise<void> {
    return Effect.runPromise(
      Effect.sync(() => {
        options?.signal?.throwIfAborted();
        this.entries.delete(providerId);
      }),
    );
  }
}
