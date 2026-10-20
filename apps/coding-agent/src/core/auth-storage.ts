import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import config from "../config.ts";
import abortModule from "../utils/abort.ts";
import paths from "../utils/paths.ts";
import text from "../utils/text.ts";
import type authStorageTypes from "./auth-storage.types.ts";
import awaitingModule from "./awaiting.ts";
import FileAuthStorageBackend from "./file-auth-storage-backend.ts";
import InMemoryAuthStorageBackend from "./in-memory-auth-storage-backend.ts";
import platformNode from "./platform-node.ts";
import resolveConfigValueModule from "./resolve-config-value.ts";
const { join } = platformNode;
const { getAgentDir } = config;
const { getFileRevision, normalizePath } = paths;
const { awaited, awaitingWith, performed } = awaitingModule;
const { stripBom } = text;
const { resolveConfigValue } = resolveConfigValueModule;
const { raceWithAbortSignal } = abortModule;

type AuthStorageData = Record<string, aiTypes.Credential>;
type AuthFileReload = {
  controller: AbortController;
  promise: Promise<AuthStorageData>;
  readers: number;
};
type AuthFileReadState = {
  data: AuthStorageData;
  revision?: string | undefined;
  reload?: AuthFileReload | undefined;
};
let sharedAuthFileReadState: { authPath: string; readState: AuthFileReadState } | undefined;
export default class AuthStorage implements aiTypes.CredentialStore {
  private storage: authStorageTypes.AuthStorageBackend;
  private authPath: string | undefined;
  private readState: AuthFileReadState;

  private constructor(storage: authStorageTypes.AuthStorageBackend, authPath?: string) {
    this.storage = storage;
    this.authPath = authPath;
    this.readState =
      authPath !== undefined && authPath !== "" && sharedAuthFileReadState?.authPath === authPath
        ? sharedAuthFileReadState.readState
        : { data: {} };
    if (authPath !== undefined && authPath !== "" && sharedAuthFileReadState === undefined) {
      sharedAuthFileReadState = { authPath, readState: this.readState };
    }
    if (authPath !== undefined && authPath !== "") {
      const revision = getFileRevision(authPath);
      if (revision !== undefined && revision === this.readState.revision) return;
    }
    this.reload();
  }

  static create(authPath: string = join(getAgentDir(), "auth.json")): AuthStorage {
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

  private parseStorageData(content: string | undefined): AuthStorageData {
    if (content === undefined || content === "") {
      return {};
    }
    return JSON.parse(stripBom(content)) as AuthStorageData;
  }

  private updateReadState(data: AuthStorageData, revision?: string): void {
    this.readState.data = data;
    this.readState.revision = revision;
  }

  reload(): void {
    let content: string | undefined;
    let revision: string | undefined;
    try {
      this.storage.withLock((current) => {
        content = current;
        revision =
          this.authPath !== undefined && this.authPath !== ""
            ? getFileRevision(this.authPath)
            : undefined;
        return { result: undefined };
      });
      this.updateReadState(this.parseStorageData(content), revision);
    } catch {}
  }

  private reloadFromStorageAsync(
    options?: aiTypes.AuthOperationOptions,
  ): Effect.Effect<AuthStorageData> {
    return awaitingWith(function* () {
      return yield* awaited(
        this.storage.withLockAsync(
          (content) =>
            Effect.runPromise(
              Effect.sync(() => {
                const currentData = this.parseStorageData(content);
                const revision =
                  this.authPath !== undefined && this.authPath !== ""
                    ? getFileRevision(this.authPath)
                    : undefined;
                this.updateReadState(currentData, revision);
                return { result: currentData };
              }),
            ),
          options,
        ),
      );
    }, this);
  }

  private readLatestData(options?: aiTypes.AuthOperationOptions): Effect.Effect<AuthStorageData> {
    return awaitingWith(function* () {
      options?.signal?.throwIfAborted();
      if (this.authPath === undefined || this.authPath === "") {
        const reload = Effect.runPromise(this.reloadFromStorageAsync(options));
        return yield* awaited(
          options?.signal === undefined ? reload.catch(() => this.readState.data) : reload,
        );
      }
      const revision = getFileRevision(this.authPath);
      if (revision !== undefined && revision === this.readState.revision)
        return this.readState.data;
      if (this.readState.reload === undefined) {
        const controller = new AbortController();
        const reload: AuthFileReload = {
          controller,
          promise: Effect.runPromise(this.reloadFromStorageAsync({ signal: controller.signal })),
          readers: 0,
        };
        this.readState.reload = reload;
        void reload.promise.then(
          () => {
            if (this.readState.reload === reload) this.readState.reload = undefined;
            return undefined;
          },
          () => {
            if (this.readState.reload === reload) this.readState.reload = undefined;
            return undefined;
          },
        );
      }

      const reload = this.readState.reload;
      reload.readers++;
      try {
        const result = raceWithAbortSignal(reload.promise, options?.signal);
        return options?.signal === undefined
          ? yield* awaited(result.catch(() => this.readState.data))
          : yield* awaited(result);
      } finally {
        reload.readers--;
        if (reload.readers === 0 && this.readState.reload === reload) {
          this.readState.reload = undefined;
          reload.controller.abort();
        }
      }
    }, this);
  }

  read(
    provider: string,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.Credential | undefined> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const credential = (yield* performed(this.readLatestData(options)))[provider];
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
        let latestData = this.readState.data;
        let revision: string | undefined;
        const result = yield* awaited(
          this.storage.withLockAsync(
            (content) =>
              Effect.runPromise(
                awaitingWith(function* () {
                  const currentData = this.parseStorageData(content);
                  const next = yield* awaited(fn(currentData[provider]));
                  if (next === undefined) {
                    latestData = currentData;
                    revision =
                      this.authPath !== undefined && this.authPath !== ""
                        ? getFileRevision(this.authPath)
                        : undefined;
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
        this.updateReadState(latestData, revision);
        return result;
      }, this),
    );
  }

  delete(provider: string, options?: aiTypes.AuthOperationOptions): Promise<void> {
    return Effect.runPromise(
      awaitingWith(function* () {
        let latestData = this.readState.data;
        yield* awaited(
          this.storage.withLockAsync(
            (content) =>
              Effect.runPromise(
                Effect.sync(() => {
                  const currentData = this.parseStorageData(content);
                  delete currentData[provider];
                  latestData = currentData;
                  return { next: prettyJson(currentData), result: undefined };
                }),
              ),
            options,
          ),
        );
        this.updateReadState(latestData);
      }, this),
    );
  }

  list(options?: aiTypes.AuthOperationOptions): Promise<readonly aiTypes.CredentialInfo[]> {
    return Effect.runPromise(
      awaitingWith(function* () {
        const entries = Object.entries(yield* performed(this.readLatestData(options)));
        options?.signal?.throwIfAborted();
        return entries.map(([providerId, credential]) => ({ providerId, type: credential.type }));
      }, this),
    );
  }
}
function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
