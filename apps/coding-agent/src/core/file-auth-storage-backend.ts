import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";
import lockfile from "proper-lockfile";

import config from "../config.ts";
import paths from "../utils/paths.ts";
import type authStorageTypes from "./auth-storage.types.ts";
import awaitingModule from "./awaiting.ts";
import platformNode from "./platform-node.ts";
import platformModule from "./platform.ts";
import nodeFs from "./platform/node/fs.ts";

const { existsSync, mkdirSync, readFileSync, writeFileSync } = nodeFs;
const { dirname } = platformNode;
const { getAuthPath } = config;
const { normalizePath } = paths;
const { nowMs, randomUnit, sleepFor } = platformModule;
const { awaited, awaitingWith, performed } = awaitingModule;
const MAX_EPERM_RETRIES = 5;
function getRetryableLockErrorCode(error: unknown): "ELOCKED" | "EPERM" | undefined {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (code === "ELOCKED") return code;
  if (code === "EPERM" && process.platform === "win32") return code;
  return undefined;
}
const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 } as const;
export default class FileAuthStorageBackend implements authStorageTypes.AuthStorageBackend {
  private authPath: string;

  constructor(authPath: string = getAuthPath()) {
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

  withLock<T>(fn: (current: string | undefined) => authStorageTypes.LockResult<T>): T {
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
    fn: (current: string | undefined) => Promise<authStorageTypes.LockResult<T>>,
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
