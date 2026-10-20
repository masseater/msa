import testing from "@msa/testing";
import { Effect } from "effect";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import FileAuthStorageBackend from "../src/core/file-auth-storage-backend.ts";

const {
  abortController,
  awaited,
  deferredPromise,
  fromJsonText,
  joinPath,
  makeDirectory,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  tempPath,
  toJsonText,
  writeJsonFile,
} = testing;

const dir = tempPath(`msa-auth-storage-cancellation-${randomSuffixSync()}`);
const authJsonPath = joinPath(dir, "auth.json");

beforeEach(() => runTest(makeDirectory(dir)));

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      yield* removePath(dir);
      yield* Effect.sync(() => vi.restoreAllMocks());
    }),
  ),
);

const writeAuthJson = (data: Record<string, unknown>): Effect.Effect<void> =>
  writeJsonFile(authJsonPath, data);

const keepsACoalescedReloadAliveWhileAnother = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  yield* writeAuthJson({ "anthropic-api": { key: "old", type: "api_key" as const } });
  const storage = AuthStorage.create(authJsonPath);
  yield* writeAuthJson({ "anthropic-api": { key: "new", type: "api_key" as const } });
  const lockGranted = deferredPromise<void>();
  const release = vi.fn(() => effectRunPromise(Effect.sync(() => {})));
  const lockSpy = vi.spyOn(lockfile, "lock").mockImplementation(() =>
    effectRunPromise(
      Effect.gen(function* () {
        yield* awaited(lockGranted.promise);
        return yield* awaited(release);
      }),
    ),
  );
  const firstController = abortController();
  const secondController = abortController();
  const first = storage.read("anthropic-api", { signal: firstController.signal });
  const second = storage.read("anthropic-api", { signal: secondController.signal });

  firstController.abort();
  yield* awaited(expect(first).rejects.toMatchObject({ name: "AbortError" }));
  lockGranted.resolve(undefined);
  yield* awaited(expect(second).resolves.toEqual({ key: "new", type: "api_key" as const }));
  expect(lockSpy).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
});

const holdsTheFileLockUntilACancelledPart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    yield* writeAuthJson({ "anthropic-api": { key: "stored", type: "api_key" as const } });
    const backend = new FileAuthStorageBackend(authJsonPath);
    return { backend, effectRunPromise };
  });

const holdsTheFileLockUntilACancelled = Effect.gen(function* () {
  const { backend, effectRunPromise } = yield* holdsTheFileLockUntilACancelledPart1();
  const controller = abortController();
  const started = deferredPromise<void>();
  const blocked = deferredPromise<void>();
  const pending = backend.withLockAsync(
    () =>
      effectRunPromise(
        Effect.gen(function* () {
          started.resolve(undefined);
          yield* awaited(blocked.promise);
          return yield* awaited({
            next: yield* toJsonText({
              openai: { key: "cancelled", type: "api_key" as const },
            }),
            result: undefined,
          });
        }),
      ),
    { signal: controller.signal },
  );

  yield* awaited(started.promise);
  controller.abort();
  const competingMutation = vi.fn(() =>
    effectRunPromise(
      Effect.gen(function* () {
        return {
          next: yield* toJsonText({
            opencode: { key: "committed", type: "api_key" as const },
          }),
          result: undefined,
        };
      }),
    ),
  );
  const competing = backend.withLockAsync(competingMutation);
  yield* Effect.sleep(20);
  expect(competingMutation).not.toHaveBeenCalled();

  blocked.resolve(undefined);
  yield* awaited(expect(pending).rejects.toMatchObject({ name: "AbortError" }));
  yield* awaited(competing);
  expect(competingMutation).toHaveBeenCalledTimes(1);
  expect(yield* fromJsonText(yield* readTextFile(authJsonPath))).toEqual({
    opencode: { key: "committed", type: "api_key" as const },
  });
});

const cancelsASignalledCredentialReadWaitingFor = Effect.gen(function* () {
  yield* writeAuthJson({ "anthropic-api": { key: "old", type: "api_key" as const } });
  const storage = AuthStorage.create(authJsonPath);
  yield* writeAuthJson({ "anthropic-api": { key: "new-value", type: "api_key" as const } });
  const release = yield* awaited(lockfile.lock(authJsonPath, { realpath: false }));
  const lockSpy = vi.spyOn(lockfile, "lock");
  const controller = abortController();
  const pending = storage.read("anthropic-api", { signal: controller.signal });

  yield* Effect.sleep(10);
  controller.abort();
  yield* awaited(expect(pending).rejects.toMatchObject({ name: "AbortError" }));
  yield* awaited(release());
  yield* Effect.sleep(150);
  expect(lockSpy).toHaveBeenCalledTimes(1);
  yield* awaited(
    expect(storage.read("anthropic-api")).resolves.toEqual({
      key: "new-value",
      type: "api_key" as const,
    }),
  );
});

describe("AuthStorage cancellation while a lock is held", () => {
  test("keeps a coalesced reload alive while another credential reader is waiting", () =>
    runTest(keepsACoalescedReloadAliveWhileAnother));

  test("holds the file lock until a cancelled active callback settles without committing it", () =>
    runTest(holdsTheFileLockUntilACancelled));

  test("cancels a signalled credential read waiting for a held file lock", () =>
    runTest(cancelsASignalledCredentialReadWaitingFor));
});

const serializesInMemoryMutationsAcrossProviders = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = AuthStorage.inMemory();
  const started = deferredPromise<void>();
  const blocked = deferredPromise<void>();
  const first = storage.modify("anthropic-api", () =>
    effectRunPromise(
      Effect.gen(function* () {
        started.resolve(undefined);
        yield* awaited(blocked.promise);
        return yield* awaited({ key: "anthropic-key", type: "api_key" as const });
      }),
    ),
  );
  yield* awaited(started.promise);
  const secondMutation = vi.fn(() =>
    effectRunPromise(awaited({ key: "openai-key", type: "api_key" as const })),
  );
  const second = storage.modify("openai", secondMutation);
  yield* Effect.sleep(0);
  expect(secondMutation).not.toHaveBeenCalled();

  blocked.resolve(undefined);
  yield* awaited(Promise.all([first, second]));
  expect(yield* awaited(storage.read("anthropic-api"))).toEqual({
    key: "anthropic-key",
    type: "api_key" as const,
  });
  expect(yield* awaited(storage.read("openai"))).toEqual({
    key: "openai-key",
    type: "api_key" as const,
  });
});

const cancelsAQueuedInMemoryMutationWithout = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const storage = AuthStorage.inMemory();
  const started = deferredPromise<void>();
  const blocked = deferredPromise<void>();
  const first = storage.modify("anthropic-api", () =>
    effectRunPromise(
      Effect.gen(function* () {
        started.resolve(undefined);
        yield* awaited(blocked.promise);
        return yield* awaited({ key: "anthropic-key", type: "api_key" as const });
      }),
    ),
  );
  yield* awaited(started.promise);
  const controller = abortController();
  const secondMutation = vi.fn(() =>
    effectRunPromise(awaited({ key: "openai-key", type: "api_key" as const })),
  );
  const second = storage.modify("openai", secondMutation, { signal: controller.signal });

  controller.abort();
  yield* awaited(expect(second).rejects.toMatchObject({ name: "AbortError" }));
  expect(secondMutation).not.toHaveBeenCalled();
  blocked.resolve(undefined);
  yield* awaited(first);
  yield* Effect.sleep(0);
  expect(secondMutation).not.toHaveBeenCalled();
  expect(yield* awaited(storage.read("openai"))).toBeUndefined();
});

describe("AuthStorage in-memory mutation queue", () => {
  test("serializes in-memory mutations across providers", () =>
    runTest(serializesInMemoryMutationsAcrossProviders));

  test("cancels a queued in-memory mutation without running it later", () =>
    runTest(cancelsAQueuedInMemoryMutationWithout));
});
