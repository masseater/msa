import testing from "@msa/testing";
import { Effect } from "effect";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage, FileAuthStorageBackend } from "../src/core/auth-storage.ts";

const {
  abortController,
  awaited,
  fromJsonText,
  joinPath,
  makeDirectory,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  tempPath,
  writeJsonFile,
} = testing;

const dir = tempPath(`msa-auth-storage-locking-${randomSuffixSync()}`);
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

const serializesConcurrentModifications = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      yield* writeAuthJson({});
      const first = AuthStorage.create(authJsonPath);
      const second = AuthStorage.create(authJsonPath);
      yield* awaited(
        Promise.all([
          first.modify("anthropic-api", () =>
            effectRunPromise(awaited({ key: "anthropic-key", type: "api_key" as const })),
          ),
          second.modify("openai", () =>
            effectRunPromise(awaited({ key: "openai-key", type: "api_key" as const })),
          ),
        ]),
      );
      expect(yield* fromJsonText(yield* readTextFile(authJsonPath))).toEqual({
        "anthropic-api": { key: "anthropic-key", type: "api_key" as const },
        openai: { key: "openai-key", type: "api_key" as const },
      });
    }),
  );

const coalescesFileReloadsAcrossConcurrentReadersAndPart1 = () =>
  Effect.gen(function* () {
    yield* writeAuthJson({ "anthropic-api": { key: "old", type: "api_key" as const } });
    const first = AuthStorage.create(authJsonPath);
    const second = AuthStorage.create(authJsonPath);
    const lockSpy = vi.spyOn(lockfile, "lock");

    yield* writeAuthJson({
      "anthropic-api": { key: "new", type: "api_key" as const },
      openai: { key: "openai-key", type: "api_key" as const },
    });
    return { first, lockSpy, second };
  });

const coalescesFileReloadsAcrossConcurrentReadersAnd = () =>
  runTest(
    Effect.gen(function* () {
      const { first, lockSpy, second } =
        yield* coalescesFileReloadsAcrossConcurrentReadersAndPart1();

      const [anthropic, openai, credentials] = yield* awaited(
        Promise.all([
          first.read("anthropic-api", { signal: abortController().signal }),
          second.read("openai", { signal: abortController().signal }),
          first.list({ signal: abortController().signal }),
        ]),
      );
      expect(anthropic).toEqual({ key: "new", type: "api_key" as const });
      expect(openai).toEqual({ key: "openai-key", type: "api_key" as const });
      expect(credentials).toEqual([
        { providerId: "anthropic-api", type: "api_key" as const },
        { providerId: "openai", type: "api_key" as const },
      ]);
      expect(lockSpy).toHaveBeenCalledTimes(1);

      yield* awaited(
        expect(second.read("anthropic-api")).resolves.toEqual({
          key: "new",
          type: "api_key" as const,
        }),
      );
      expect(lockSpy).toHaveBeenCalledTimes(1);

      const otherPath = joinPath(dir, "other-auth.json");
      yield* writeJsonFile(otherPath, { other: { key: "other-key", type: "api_key" as const } });
      const otherFirst = AuthStorage.create(otherPath);
      const otherSecond = AuthStorage.create(otherPath);
      yield* awaited(otherFirst.read("other"));
      yield* awaited(otherSecond.read("other"));
      yield* awaited(otherFirst.list());
      expect(lockSpy).toHaveBeenCalledTimes(1);

      const third = AuthStorage.create(authJsonPath);
      yield* writeAuthJson({ "anthropic-api": { key: "newest", type: "api_key" as const } });
      const [firstReload, thirdReload] = yield* awaited(
        Promise.all([first.read("anthropic-api"), third.read("anthropic-api")]),
      );
      expect(firstReload).toEqual({ key: "newest", type: "api_key" as const });
      expect(thirdReload).toEqual({ key: "newest", type: "api_key" as const });
      expect(lockSpy).toHaveBeenCalledTimes(2);
    }),
  );

const doesNotWriteAfterLockAcquisitionFailure = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      yield* writeAuthJson({ "anthropic-api": { key: "stored", type: "api_key" as const } });
      const storage = AuthStorage.create(authJsonPath);
      const lockSpy = vi
        .spyOn(lockfile, "lock")
        .mockRejectedValueOnce(new Error("lock unavailable"));

      yield* awaited(
        expect(
          storage.modify("openai", () =>
            effectRunPromise(awaited({ key: "new", type: "api_key" as const })),
          ),
        ).rejects.toThrow("lock unavailable"),
      );
      expect(yield* awaited(storage.read("openai"))).toBeUndefined();

      lockSpy.mockRestore();
      yield* awaited(
        storage.modify("openai", () =>
          effectRunPromise(awaited({ key: "new", type: "api_key" as const })),
        ),
      );
      expect(yield* awaited(storage.read("anthropic-api"))).toEqual({
        key: "stored",
        type: "api_key" as const,
      });
      expect(yield* awaited(storage.read("openai"))).toEqual({
        key: "new",
        type: "api_key" as const,
      });
    }),
  );

const retriesABrieflyContendedFileLock = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      yield* writeAuthJson({ "anthropic-api": { key: "stored", type: "api_key" as const } });
      const backend = new FileAuthStorageBackend(authJsonPath);
      const release = vi.fn(() => effectRunPromise(Effect.sync(() => {})));
      const lockSpy = vi
        .spyOn(lockfile, "lock")
        .mockRejectedValueOnce(Object.assign(new Error("locked"), { code: "ELOCKED" }))
        .mockResolvedValueOnce(release);
      vi.spyOn(Math, "random").mockReturnValue(0);
      const update = vi.fn(() => effectRunPromise(awaited({ result: undefined })));

      yield* awaited(backend.withLockAsync(update));

      expect(lockSpy).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    }),
  );

const surfacesACompromisedFileStorageLock = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      yield* writeAuthJson({ "anthropic-api": { key: "stored", type: "api_key" as const } });
      const backend = new FileAuthStorageBackend(authJsonPath);
      const update = vi.fn(() =>
        effectRunPromise(awaited({ next: JSON.stringify({}), result: undefined })),
      );
      const compromised = new Error("lock compromised");
      vi.spyOn(lockfile, "lock").mockImplementation((_file, options) =>
        effectRunPromise(
          Effect.gen(function* () {
            const nestedRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

            options?.onCompromised?.(compromised);
            return yield* awaited(() => nestedRunPromise(Effect.sync(() => {})));
          }),
        ),
      );

      yield* awaited(expect(backend.withLockAsync(update)).rejects.toThrow(compromised));
      expect(update).not.toHaveBeenCalled();
      expect(yield* fromJsonText(yield* readTextFile(authJsonPath))).toEqual({
        "anthropic-api": { key: "stored", type: "api_key" as const },
      });
    }),
  );

describe("AuthStorage locking", () => {
  test("serializes concurrent modifications", serializesConcurrentModifications);

  test(
    "coalesces file reloads across concurrent readers and storage instances",
    coalescesFileReloadsAcrossConcurrentReadersAnd,
  );

  test(
    "does not write after lock acquisition failure and recovers on retry",
    doesNotWriteAfterLockAcquisitionFailure,
  );

  test("retries a briefly contended file lock", retriesABrieflyContendedFileLock);

  test("surfaces a compromised file storage lock", surfacesACompromisedFileStorageLock);
});
