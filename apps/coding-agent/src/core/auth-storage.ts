import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";
import lockfile from "proper-lockfile";

import { getAgentDir } from "../config.ts";
import { raceWithAbortSignal } from "../utils/abort.ts";
import { toErrorMessage } from "../utils/errors.ts";
import { getFileRevision, normalizePath } from "../utils/paths.ts";
import { stripBom } from "../utils/text.ts";
import { awaited, awaitingWith, performed } from "./awaiting.ts";
import { dirname, join } from "./platform-node.ts";
import { nowMs, randomUnit, sleepFor } from "./platform.ts";
import { isCommandConfigValue, resolveConfigValue } from "./resolve-config-value.ts";

type AuthStorageData = Record<string, aiTypes.Credential>;

const MAX_EPERM_RETRIES = 5;

function getRetryableLockErrorCode(error: unknown): "ELOCKED" | "EPERM" | undefined {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (code === "ELOCKED") return code;
  if (code === "EPERM" && process.platform === "win32") return code;
  return undefined;
}

type LockResult<T> = {
  result: T;
  next?: string;
};

const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 } as const;

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

export interface AuthStorageBackend {
  withLock<T>(fn: (current: string | undefined) => LockResult<T>): T;
  withLockAsync<T>(
    fn: (current: string | undefined) => Promise<LockResult<T>>,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<T>;
}

export class FileAuthStorageBackend implements AuthStorageBackend {
  private authPath: string;

  constructor(authPath: string = join(getAgentDir(), "auth.json")) {
    this.authPath = normalizePath(authPath);
  }

  private ensureParentDir(): void {
    const dir = dirname(this.authPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { mode: 0o700, recursive: true });
    }
  }

  private ensureFileExists(): void {
    if (!existsSync(this.authPath)) {
      writeFileSync(this.authPath, "{}", AUTH_FILE_WRITE_OPTIONS);
    }
  }

  private acquireLockSyncWithRetry(path: string): () => void {
    const maxAttempts = 10;
    const delayMs = 20;
    for (let attempt = 1; ; attempt++) {
      try {
        return lockfile.lockSync(path, { realpath: false });
      } catch (error) {
        if (getRetryableLockErrorCode(error) === undefined || attempt === maxAttempts) throw error;
        const start = nowMs();
        while (nowMs() - start < delayMs) {}
      }
    }
  }

  withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
    this.ensureParentDir();
    this.ensureFileExists();

    let release: (() => void) | undefined;
    try {
      release = this.acquireLockSyncWithRetry(this.authPath);
      const current = existsSync(this.authPath) ? readFileSync(this.authPath, "utf-8") : undefined;
      const { result, next } = fn(current);
      if (next !== undefined) {
        writeFileSync(this.authPath, next, AUTH_FILE_WRITE_OPTIONS);
      }
      return result;
    } finally {
      if (release !== undefined) {
        release();
      }
    }
  }

  private acquireLockAsync(
    signal: AbortSignal | undefined,
    onCompromised: (error: Error) => void,
  ): Effect.Effect<() => Promise<void>> {
    return awaitingWith(function* () {
      const staleMs = 30_000;
      const maxDelayMs = 2_000;
      const deadline = nowMs() + staleMs;
      let retry = 0;
      let epermRetries = 0;
      while (true) {
        signal?.throwIfAborted();
        let release: (() => Promise<void>) | undefined;
        try {
          release = yield* awaited(
            lockfile.lock(this.authPath, {
              onCompromised,
              realpath: false,
              retries: 0,
              stale: staleMs,
            }),
          );
        } catch (error) {
          signal?.throwIfAborted();
          const code = getRetryableLockErrorCode(error);
          const remainingMs = deadline - nowMs();
          if (code === undefined || remainingMs <= 0) throw error;
          if (code === "EPERM" && ++epermRetries > MAX_EPERM_RETRIES) throw error;
          const baseDelayMs = Math.min(10 * 2 ** retry, maxDelayMs / 2);
          retry++;
          const delayMs = Math.min(Math.round(baseDelayMs * (1 + randomUnit())), remainingMs);
          yield* performed(sleepFor(delayMs, signal));
          continue;
        }
        if (signal?.aborted === true) {
          yield* awaited(release());
          signal.throwIfAborted();
        }
        return release;
      }
    }, this);
  }

  withLockAsync<T>(
    fn: (current: string | undefined) => Promise<LockResult<T>>,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<T> {
    return Effect.runPromise(
      awaitingWith(function* () {
        options?.signal?.throwIfAborted();
        this.ensureParentDir();
        this.ensureFileExists();

        let release: (() => Promise<void>) | undefined;
        let lockCompromised = false;
        let lockCompromisedError: Error | undefined;
        const throwIfCompromised = () => {
          if (lockCompromised) {
            throw lockCompromisedError ?? new Error("Auth storage lock was compromised");
          }
        };

        try {
          release = yield* performed(
            this.acquireLockAsync(options?.signal, (error) => {
              lockCompromised = true;
              lockCompromisedError = error;
            }),
          );

          throwIfCompromised();
          options?.signal?.throwIfAborted();
          const current = existsSync(this.authPath)
            ? readFileSync(this.authPath, "utf-8")
            : undefined;
          const { result, next } = yield* awaited(fn(current));
          throwIfCompromised();
          options?.signal?.throwIfAborted();
          if (next !== undefined) {
            writeFileSync(this.authPath, next, AUTH_FILE_WRITE_OPTIONS);
          }
          throwIfCompromised();
          return result;
        } finally {
          if (release !== undefined) {
            try {
              yield* awaited(release());
            } catch {}
          }
        }
      }, this),
    );
  }
}

export class ReadOnlyAuthStorage implements aiTypes.CredentialStore {
  private readonly authPath: string;
  private data: AuthStorageData | undefined;

  constructor(authPath: string = join(getAgentDir(), "auth.json")) {
    this.authPath = normalizePath(authPath);
  }

  private load(): AuthStorageData {
    if (this.data !== undefined) return this.data;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripBom(readFileSync(this.authPath, "utf-8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.data = {};
        return this.data;
      }
      throw new Error(`Failed to read auth.json: ${toErrorMessage(error)}`, { cause: error });
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Invalid auth.json: expected an object");
    }
    for (const [providerId, credential] of Object.entries(parsed)) {
      if (typeof credential !== "object" || credential === null || Array.isArray(credential)) {
        throw new Error(`Invalid auth.json credential for provider "${providerId}"`);
      }
      const value = credential as Record<string, unknown>;
      if (value["type"] === "api_key") {
        const validKey = value["key"] === undefined || typeof value["key"] === "string";
        const validEnv =
          value["env"] === undefined ||
          (typeof value["env"] === "object" &&
            value["env"] !== null &&
            !Array.isArray(value["env"]) &&
            Object.values(value["env"]).every((entry) => typeof entry === "string"));
        if (validKey && validEnv) continue;
      } else if (
        value["type"] === "oauth" &&
        typeof value["access"] === "string" &&
        typeof value["refresh"] === "string" &&
        typeof value["expires"] === "number" &&
        Number.isFinite(value["expires"])
      ) {
        continue;
      }
      throw new Error(`Invalid auth.json credential for provider "${providerId}"`);
    }

    this.data = parsed as AuthStorageData;
    return this.data;
  }

  read(
    providerId: string,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.Credential | undefined> {
    return Effect.runPromise(
      Effect.sync(() => {
        options?.signal?.throwIfAborted();
        const credential = this.load()[providerId];
        options?.signal?.throwIfAborted();
        if (credential === undefined) return undefined;
        if (
          credential.type !== "api_key" ||
          credential.key === undefined ||
          credential.key === "" ||
          isCommandConfigValue(credential.key)
        ) {
          return structuredClone(credential);
        }
        return { ...credential, key: resolveConfigValue(credential.key, credential.env) };
      }),
    );
  }

  list(options?: aiTypes.AuthOperationOptions): Promise<readonly aiTypes.CredentialInfo[]> {
    return Effect.runPromise(
      Effect.sync(() => {
        options?.signal?.throwIfAborted();
        const credentials = Object.entries(this.load()).map(([providerId, credential]) => ({
          providerId,
          type: credential.type,
        }));
        options?.signal?.throwIfAborted();
        return credentials;
      }),
    );
  }

  modify(
    _providerId: string,
    _fn: (current: aiTypes.Credential | undefined) => Promise<aiTypes.Credential | undefined>,
    _options?: aiTypes.AuthOperationOptions,
  ): Promise<aiTypes.Credential | undefined> {
    return Effect.runPromise(
      Effect.sync(() => {
        throw new Error("Read-only credential storage cannot modify auth.json");
      }),
    );
  }

  delete(_providerId: string, _options?: aiTypes.AuthOperationOptions): Promise<void> {
    return Effect.runPromise(
      Effect.sync(() => {
        throw new Error("Read-only credential storage cannot modify auth.json");
      }),
    );
  }
}

export class InMemoryAuthStorageBackend implements AuthStorageBackend {
  private value: string | undefined;
  private asyncChain: Promise<unknown> = Promise.resolve();

  withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
    const { result, next } = fn(this.value);
    if (next !== undefined) {
      this.value = next;
    }
    return result;
  }

  withLockAsync<T>(
    fn: (current: string | undefined) => Promise<LockResult<T>>,
    options?: aiTypes.AuthOperationOptions,
  ): Promise<T> {
    const previous = this.asyncChain;
    const operation = (() =>
      Effect.runPromise(
        awaitingWith(function* () {
          yield* awaited(previous.catch(() => {}));
          options?.signal?.throwIfAborted();
          const { result, next } = yield* awaited(fn(this.value));
          options?.signal?.throwIfAborted();
          if (next !== undefined) {
            this.value = next;
          }
          return result;
        }, this),
      ))();
    this.asyncChain = operation.catch(() => {});
    return raceWithAbortSignal(operation, options?.signal);
  }
}

export class AuthStorage implements aiTypes.CredentialStore {
  private storage: AuthStorageBackend;
  private authPath: string | undefined;
  private readState: AuthFileReadState;

  private constructor(storage: AuthStorageBackend, authPath?: string) {
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

  static fromStorage(storage: AuthStorageBackend): AuthStorage {
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

export function readStoredCredential(
  providerId: string,
  authPath: string = join(getAgentDir(), "auth.json"),
): aiTypes.Credential | undefined {
  try {
    const data = JSON.parse(
      stripBom(readFileSync(normalizePath(authPath), "utf-8")),
    ) as AuthStorageData;
    return data[providerId];
  } catch {
    return undefined;
  }
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
