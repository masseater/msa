import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import config from "../config.ts";
import paths from "../utils/paths.ts";
import AuthDataReader from "./auth-data-reader.ts";
import type authStorageTypes from "./auth-storage.types.ts";
import awaitingModule from "./awaiting.ts";
import FileAuthStorageBackend from "./file-auth-storage-backend.ts";
import InMemoryAuthStorageBackend from "./in-memory-auth-storage-backend.ts";
import resolveConfigValueModule from "./resolve-config-value.ts";
const { getAuthPath } = config;
const { normalizePath } = paths;
const { awaited, awaitingWith, performed } = awaitingModule;
const { resolveConfigValue } = resolveConfigValueModule;

type AuthStorageData = Record<string, aiTypes.Credential>;

export default class AuthStorage implements aiTypes.CredentialStore {
  private storage: authStorageTypes.AuthStorageBackend;
  private reader: AuthDataReader;

  private constructor(storage: authStorageTypes.AuthStorageBackend, authPath?: string) {
    this.storage = storage;
    this.reader = new AuthDataReader(storage, authPath);
    if (this.reader.isCurrent()) return;
    this.reload();
  }

  static create(authPath: string = getAuthPath()): AuthStorage {
    const normalizedAuthPath = normalizePath(authPath);
    return new AuthStorage(new FileAuthStorageBackend(normalizedAuthPath), normalizedAuthPath);
  }

  static fromStorage(storage: authStorageTypes.AuthStorageBackend): AuthStorage {
    return new AuthStorage(storage);
  }

  static inMemory(data: AuthStorageData = {}): AuthStorage {
    const storage = new InMemoryAuthStorageBackend();
    storage.withLock(() => ({ next: prettyJson(data), result: undefined }));
    return AuthStorage.fromStorage(storage);
  }

  reload(): void {
    this.reader.reload();
  }

  read(
    provider: string,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.Credential | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const credential = (yield* performed(this.reader.latest(options)))[provider];
        options?.signal?.throwIfAborted();
        if (credential?.type !== "api_key") return credential;
        if (credential.key === undefined) return credential;
        return { ...credential, key: resolveConfigValue(credential.key, credential.env) };
      }, this),
    );
  }

  modify(
    provider: string,
    fn: (current: aiTypes.Credential | undefined) => Promise<aiTypes.Credential | undefined>,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.Credential | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        let latestData = this.reader.data;
        let revision: string | undefined;
        const result = yield* awaited(
          this.storage.withLockAsync(
            (content) =>
              Effect.runPromise(
                awaitingWith(function* () {
                  const currentData = this.reader.parse(content);
                  const next = yield* awaited(fn(currentData[provider]));
                  if (next === undefined) {
                    latestData = currentData;
                    revision = this.reader.fileRevision();
                    return { result: currentData[provider] };
                  }

                  const merged: AuthStorageData = { ...currentData, [provider]: next };
                  latestData = merged;
                  return { next: prettyJson(merged), result: next };
                }, this),
              ),
            options,
          ),
        );
        this.reader.update(latestData, revision);
        return result;
      }, this),
    );
  }

  delete(provider: string, options?: aiTypes.AuthOperationOptions): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        let latestData = this.reader.data;
        yield* awaited(
          this.storage.withLockAsync(
            (content) =>
              Effect.runPromise(
                Effect.sync(() => {
                  const currentData = this.reader.parse(content);
                  delete currentData[provider];
                  latestData = currentData;
                  return { next: prettyJson(currentData), result: undefined };
                }),
              ),
            options,
          ),
        );
        this.reader.update(latestData);
      }, this),
    );
  }

  list(options?: aiTypes.AuthOperationOptions): Promise<readonly aiTypes.CredentialInfo[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const entries = Object.entries(yield* performed(this.reader.latest(options)));
        options?.signal?.throwIfAborted();
        return entries.map(([providerId, credential]) => ({ providerId, type: credential.type }));
      }, this),
    );
  }
}
function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
