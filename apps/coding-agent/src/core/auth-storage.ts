import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import config from "../config.ts";
import text from "../utils/text.ts";
import AuthDataReader from "./auth-data-reader.ts";
import type authStorageTypes from "./auth-storage.types.ts";
import awaitingModule from "./awaiting.ts";
import FileAuthStorageBackend from "./file-auth-storage-backend.ts";
import InMemoryAuthStorageBackend from "./in-memory-auth-storage-backend.ts";
import resolveConfigValueModule from "./resolve-config-value.ts";

const { prettyJson } = text;
const { getAuthPath } = config;
const { awaited, performed, promisedWith } = awaitingModule;
const { resolveConfigValue } = resolveConfigValueModule;

export default class AuthStorage implements aiTypes.CredentialStore {
  private storage: authStorageTypes.AuthStorageBackend;
  private reader: AuthDataReader;

  private constructor(storage: authStorageTypes.AuthStorageBackend, authPath?: string) {
    this.storage = storage;
    this.reader = new AuthDataReader(storage, authPath);
  }

  static create(authPath: string = getAuthPath()): AuthStorage {
    const backend = new FileAuthStorageBackend(authPath);
    return new AuthStorage(backend, backend.authPath);
  }

  static fromStorage(storage: authStorageTypes.AuthStorageBackend): AuthStorage {
    return new AuthStorage(storage);
  }

  static inMemory(data: Readonly<Record<string, aiTypes.Credential>> = {}): AuthStorage {
    return AuthStorage.fromStorage(new InMemoryAuthStorageBackend(prettyJson(data)));
  }

  reload(): Promise<void> {
    return this.reader.reload();
  }

  read(
    provider: string,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.Credential | undefined> {
    return promisedWith(function* () {
      const credential = (yield* performed(this.reader.latest(options))).get(provider);
      options?.signal?.throwIfAborted();
      if (credential?.type !== "api_key") return credential;
      if (credential.key === undefined) return credential;
      return { ...credential, key: resolveConfigValue(credential.key, credential.env) };
    }, this);
  }

  modify(
    provider: string,
    fn: (current: aiTypes.Credential | undefined) => Promise<aiTypes.Credential | undefined>,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.Credential | undefined> {
    return promisedWith(function* () {
      let latestData = this.reader.data;
      let revision: string | undefined;
      const result = yield* awaited(
        this.storage.withLockAsync(
          (content) =>
            promisedWith(function* () {
              const currentData = this.reader.parse(content);
              const next = yield* awaited(fn(currentData.get(provider)));
              if (next === undefined) {
                latestData = currentData;
                revision = yield* awaited(this.reader.fileRevision());
                return { result: currentData.get(provider) };
              }

              const merged = new Map(currentData).set(provider, next);
              latestData = merged;
              return { next: prettyJson(Object.fromEntries(merged)), result: next };
            }, this),
          options,
        ),
      );
      this.reader.update(latestData, revision);
      return result;
    }, this);
  }

  delete(provider: string, options?: aiTypes.AuthOperationOptions): Promise<void> {
    return promisedWith(function* () {
      let latestData = this.reader.data;
      yield* awaited(
        this.storage.withLockAsync(
          (content) =>
            Effect.runPromise(
              Effect.sync(() => {
                const remaining = new Map(this.reader.parse(content));
                remaining.delete(provider);
                latestData = remaining;
                return { next: prettyJson(Object.fromEntries(remaining)), result: undefined };
              }),
            ),
          options,
        ),
      );
      this.reader.update(latestData);
    }, this);
  }

  list(options?: aiTypes.AuthOperationOptions): Promise<readonly aiTypes.CredentialInfo[]> {
    return promisedWith(function* () {
      const entries = [...(yield* performed(this.reader.latest(options)))];
      options?.signal?.throwIfAborted();
      return entries.map(([providerId, credential]) => ({ providerId, type: credential.type }));
    }, this);
  }
}
