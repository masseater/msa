import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";
import lockfile from "proper-lockfile";

import config from "../config.ts";
import paths from "../utils/paths.ts";
import type authStorageTypes from "./auth-storage.types.ts";
import awaitingModule from "./awaiting.ts";
import platformModule from "./platform/index.ts";
const { dirname, nowMs, randomUnit, sleepFor } = platformModule;
const { exists, makeDirectory, readText, writeFile } = platformModule.files;
const { getAuthPath } = config;
const { normalizePath } = paths;
const { awaited, awaitingWith, performed } = awaitingModule;
const MAX_EPERM_RETRIES = 5;
function getRetryableLockErrorCode(error: unknown): "ELOCKED" | "EPERM" | undefined {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (code === "ELOCKED") return code;
  if (code === "EPERM" && process.platform === "win32") return code;
  return undefined;
}
const AUTH_FILE_MODE = 0o600;
export default class FileAuthStorageBackend implements authStorageTypes.AuthStorageBackend {
  private authPath: string;

  constructor(authPath: string = getAuthPath()) {
    this.authPath = normalizePath(authPath);
  }

  private ensureFile(): Promise<void> {
    return makeDirectory({ mode: 0o700, path: dirname(this.authPath) })
      .then(() => exists(this.authPath))
      .then((found) =>
        found
          ? undefined
          : writeFile({ data: "{}", flag: "wx", mode: AUTH_FILE_MODE, path: this.authPath }).catch(
              () => undefined,
            ),
      );
  }

  private readCurrent(): Promise<string | undefined> {
    return exists(this.authPath).then((found) => (found ? readText(this.authPath) : undefined));
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
        yield* awaited(this.ensureFile());

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
          const current = yield* awaited(this.readCurrent());
          const { result, next } = yield* awaited(fn(current));
          throwIfCompromised();
          options?.signal?.throwIfAborted();
          if (next !== undefined) {
            yield* awaited(writeFile({ data: next, mode: AUTH_FILE_MODE, path: this.authPath }));
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
