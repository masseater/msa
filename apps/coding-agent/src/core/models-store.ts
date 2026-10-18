import type { ModelsStore, ModelsStoreEntry, ModelsStoreOperationOptions } from "@msa/ai";
import * as Effect from "effect/Effect";

import { getAgentDir } from "../config.ts";
import { raceWithAbortSignal } from "../utils/abort.ts";
import { getFileRevision, normalizePath } from "../utils/paths.ts";
import { stripBom } from "../utils/text.ts";
import { type AuthStorageBackend, FileAuthStorageBackend } from "./auth-storage.ts";
import { awaited, awaitingWith, performed } from "./awaiting.ts";
import { join } from "./platform-node.ts";

type StoredModels = Record<string, ModelsStoreEntry>;

type ModelsFileReload = {
  controller: AbortController;
  promise: Promise<StoredModels>;
  readers: number;
};

type ModelsFileReadState = {
  data: StoredModels;
  revision?: string | undefined;
  reload?: ModelsFileReload | undefined;
};

let sharedModelsFileReadState: { path: string; readState: ModelsFileReadState } | undefined;

export class InMemoryCodingAgentModelsStore implements ModelsStore {
  private readonly entries = new Map<string, ModelsStoreEntry>();

  read(
    providerId: string,
    options?: ModelsStoreOperationOptions,
  ): Promise<ModelsStoreEntry | undefined> {
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
    entry: ModelsStoreEntry,
    options?: ModelsStoreOperationOptions,
  ): Promise<void> {
    return Effect.runPromise(
      Effect.sync(() => {
        options?.signal?.throwIfAborted();
        this.entries.set(providerId, structuredClone(entry));
      }),
    );
  }

  delete(providerId: string, options?: ModelsStoreOperationOptions): Promise<void> {
    return Effect.runPromise(
      Effect.sync(() => {
        options?.signal?.throwIfAborted();
        this.entries.delete(providerId);
      }),
    );
  }
}

export class FileModelsStore implements ModelsStore {
  private readonly storage: AuthStorageBackend;
  private readonly path: string;
  private readonly readState: ModelsFileReadState;

  constructor(path: string = join(getAgentDir(), "models-store.json")) {
    this.path = normalizePath(path);
    this.storage = new FileAuthStorageBackend(this.path);
    this.readState =
      sharedModelsFileReadState?.path === this.path
        ? sharedModelsFileReadState.readState
        : { data: {} };
    if (sharedModelsFileReadState === undefined) {
      sharedModelsFileReadState = { path: this.path, readState: this.readState };
    }
  }

  private parse(content: string | undefined): StoredModels {
    return content !== undefined && content !== ""
      ? (JSON.parse(stripBom(content)) as StoredModels)
      : {};
  }

  private updateReadState(
    readState: ModelsFileReadState,
    data: StoredModels,
    revision?: string,
  ): void {
    readState.data = data;
    readState.revision = revision;
  }

  private reloadFromStorage(
    readState: ModelsFileReadState,
    options?: ModelsStoreOperationOptions,
  ): Promise<StoredModels> {
    return this.storage.withLockAsync(
      (content) =>
        Effect.runPromise(
          Effect.sync(() => {
            const data = this.parse(content);
            this.updateReadState(readState, data, getFileRevision(this.path));
            return { result: data };
          }),
        ),
      options,
    );
  }

  private readLatest(
    readState: ModelsFileReadState,
    options?: ModelsStoreOperationOptions,
  ): Effect.Effect<StoredModels> {
    return awaitingWith(function* () {
      options?.signal?.throwIfAborted();
      const revision = getFileRevision(this.path);
      if (revision !== undefined && revision === readState.revision) return readState.data;
      if (readState.reload === undefined) {
        const controller = new AbortController();
        const reload: ModelsFileReload = {
          controller,
          promise: this.reloadFromStorage(readState, { signal: controller.signal }),
          readers: 0,
        };
        readState.reload = reload;
        void reload.promise.then(
          () => {
            if (readState.reload === reload) readState.reload = undefined;
            return undefined;
          },
          () => {
            if (readState.reload === reload) readState.reload = undefined;
            return undefined;
          },
        );
      }

      const reload = readState.reload;
      reload.readers++;
      try {
        return yield* awaited(raceWithAbortSignal(reload.promise, options?.signal));
      } finally {
        reload.readers--;
        if (reload.readers === 0 && readState.reload === reload) {
          readState.reload = undefined;
          reload.controller.abort();
        }
      }
    }, this);
  }

  read(
    providerId: string,
    options?: ModelsStoreOperationOptions,
  ): Promise<ModelsStoreEntry | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const entry = (yield* performed(this.readLatest(this.readState, options)))[providerId];
        options?.signal?.throwIfAborted();
        return entry === undefined ? undefined : structuredClone(entry);
      }, this),
    );
  }

  write(
    providerId: string,
    entry: ModelsStoreEntry,
    options?: ModelsStoreOperationOptions,
  ): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        let latest: StoredModels | undefined;
        yield* awaited(
          this.storage.withLockAsync(
            (content) =>
              Effect.runPromise(
                Effect.sync(() => {
                  const current = this.parse(content);
                  current[providerId] = structuredClone(entry);
                  latest = current;
                  return { result: undefined, next: prettyJson(current) };
                }),
              ),
            options,
          ),
        );
        if (latest !== undefined) this.updateReadState(this.readState, latest);
      }, this),
    );
  }

  delete(providerId: string, options?: ModelsStoreOperationOptions): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        let latest: StoredModels | undefined;
        yield* awaited(
          this.storage.withLockAsync(
            (content) =>
              Effect.runPromise(
                Effect.sync(() => {
                  const current = this.parse(content);
                  delete current[providerId];
                  latest = current;
                  return { result: undefined, next: prettyJson(current) };
                }),
              ),
            options,
          ),
        );
        if (latest !== undefined) this.updateReadState(this.readState, latest);
      }, this),
    );
  }
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
