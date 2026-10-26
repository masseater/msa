import testing from "@msa/testing";
import { Effect } from "effect";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import FileAuthStorageBackend from "../src/core/file-auth-storage-backend.ts";
import lockAttempts from "./lock-attempts.ts";

const { freezeLockRetries, observeLockAttempts } = lockAttempts;

const {
  abortController,
  awaited,
  fromJsonText,
  joinPath,
  makeDirectory,
  pathExists,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  tempPath,
  writeJsonFile,
} = testing;

const dir = tempPath(`msa-auth-storage-permissions-${randomSuffixSync()}`);

const authJsonPath = joinPath(dir, "auth.json");

beforeEach(() => runTest(makeDirectory(dir)));

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      yield* Effect.sync(() => vi.useRealTimers());
      yield* removePath(dir);
      yield* Effect.sync(() => vi.restoreAllMocks());
    }),
  ),
);

const writeAuthJson = (data: Record<string, unknown>): Effect.Effect<void> =>
  writeJsonFile(authJsonPath, data);

const preAbortedFileOperationsDoNotCreate = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const backend = new FileAuthStorageBackend(authJsonPath);
      const controller = abortController();
      controller.abort();
      const update = vi.fn(() =>
        effectRunPromise(awaited({ next: JSON.stringify({}), result: undefined })),
      );

      yield* awaited(
        expect(backend.withLockAsync(update, { signal: controller.signal })).rejects.toMatchObject({
          name: "AbortError",
        }),
      );
      expect(update).not.toHaveBeenCalled();
      expect(yield* pathExists(authJsonPath)).toBe(false);
    }),
  );

const abortsWhileWaitingForAHeldFile = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      yield* writeAuthJson({ "anthropic-api": { key: "stored", type: "api_key" as const } });
      freezeLockRetries();
      const release = yield* awaited(lockfile.lock(authJsonPath, { realpath: false }));
      const { refused, spy: lockSpy } = observeLockAttempts();
      const backend = new FileAuthStorageBackend(authJsonPath);
      const controller = abortController();
      const update = vi.fn(() =>
        effectRunPromise(awaited({ next: JSON.stringify({}), result: undefined })),
      );
      const pending = backend.withLockAsync(update, { signal: controller.signal });

      yield* awaited(refused);
      controller.abort();
      yield* awaited(expect(pending).rejects.toMatchObject({ name: "AbortError" }));
      expect(update).not.toHaveBeenCalled();

      yield* awaited(release());
      expect(vi.getTimerCount()).toBe(0);
      expect(lockSpy).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
      expect(yield* fromJsonText(yield* readTextFile(authJsonPath))).toEqual({
        "anthropic-api": { key: "stored", type: "api_key" as const },
      });
    }),
  );

const releasesAFileLockAcquiredConcurrentlyWith = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      yield* writeAuthJson({ "anthropic-api": { key: "stored", type: "api_key" as const } });
      const backend = new FileAuthStorageBackend(authJsonPath);
      const controller = abortController();
      const release = vi.fn(() => effectRunPromise(Effect.sync(() => {})));
      vi.spyOn(lockfile, "lock").mockImplementation(() =>
        effectRunPromise(
          Effect.gen(function* () {
            controller.abort();
            return yield* awaited(release);
          }),
        ),
      );
      const update = vi.fn(() =>
        effectRunPromise(awaited({ next: JSON.stringify({}), result: undefined })),
      );

      yield* awaited(
        expect(backend.withLockAsync(update, { signal: controller.signal })).rejects.toMatchObject({
          name: "AbortError",
        }),
      );
      yield* Effect.sleep(0);
      expect(update).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    }),
  );

describe("AuthStorage cancellation before a lock is held", () => {
  test(
    "pre-aborted file operations do not create the backing file or run the mutation",
    preAbortedFileOperationsDoNotCreate,
  );

  test(
    "aborts while waiting for a held file lock without running the mutation later",
    abortsWhileWaitingForAHeldFile,
  );

  test(
    "releases a file lock acquired concurrently with cancellation before mutation",
    releasesAFileLockAcquiredConcurrentlyWith,
  );
});
