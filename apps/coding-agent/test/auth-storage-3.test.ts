import testing from "@msa/testing";
import { Effect, FileSystem } from "effect";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import FileAuthStorageBackend from "../src/core/file-auth-storage-backend.ts";

const {
  awaited,
  changeMode,
  joinPath,
  makeDirectory,
  randomSuffixSync,
  removePath,
  runTest,
  tempPath,
  provideNode,
  writeJsonFile,
} = testing;

const dir = tempPath(`msa-auth-storage-permissions-${randomSuffixSync()}`);

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

const fileMode = (path: string): Effect.Effect<number> =>
  provideNode(
    Effect.flatMap(FileSystem.FileSystem, (service) => service.stat(path)).pipe(
      Effect.orDie,
      Effect.map((info) => Number(info.mode) & 0o777),
    ),
  );

const createsNewAuthFilesWithOwnerOnly = () =>
  runTest(
    Effect.gen(function* () {
      AuthStorage.create(authJsonPath);

      expect(yield* fileMode(authJsonPath)).toBe(0o600);
    }),
  );

const preservesTheModeOfAnExistingAuth = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      yield* writeAuthJson({ "anthropic-api": { key: "old", type: "api_key" as const } });
      yield* changeMode(authJsonPath, 0o660);
      const storage = AuthStorage.create(authJsonPath);

      yield* awaited(
        storage.modify("anthropic-api", () =>
          effectRunPromise(awaited({ key: "new", type: "api_key" as const })),
        ),
      );

      expect(yield* fileMode(authJsonPath)).toBe(0o660);
    }),
  );

describe("AuthStorage file permissions", () => {
  test.skipIf(process.platform === "win32")(
    "creates new auth files with owner-only permissions",
    createsNewAuthFilesWithOwnerOnly,
  );

  test.skipIf(process.platform === "win32")(
    "preserves the mode of an existing auth file",
    preservesTheModeOfAnExistingAuth,
  );
});

const eperm = () => Object.assign(new Error("operation not permitted"), { code: "EPERM" });

const originalPlatform = process.platform;

const setPlatform = (platform: NodeJS.Platform) =>
  Object.defineProperty(process, "platform", { configurable: true, value: platform });

const retriesTransientEpermOnWindowsAsync = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      setPlatform("win32");
      yield* writeAuthJson({});
      const backend = new FileAuthStorageBackend(authJsonPath);
      const release = vi.fn(() => effectRunPromise(Effect.sync(() => {})));
      const lockSpy = vi
        .spyOn(lockfile, "lock")
        .mockRejectedValueOnce(eperm())
        .mockResolvedValueOnce(release);
      vi.spyOn(Math, "random").mockReturnValue(0);
      const update = vi.fn(() => effectRunPromise(awaited({ result: undefined })));

      yield* awaited(backend.withLockAsync(update));

      expect(lockSpy).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    }),
  );

const surfacesPersistentEpermOnWindowsAfterA = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      setPlatform("win32");
      yield* writeAuthJson({});
      const backend = new FileAuthStorageBackend(authJsonPath);
      const lockSpy = vi.spyOn(lockfile, "lock").mockImplementation(() =>
        effectRunPromise(
          Effect.sync(() => {
            throw eperm();
          }),
        ),
      );
      vi.spyOn(Math, "random").mockReturnValue(0);
      const update = vi.fn(() => effectRunPromise(awaited({ result: undefined })));

      yield* awaited(
        expect(backend.withLockAsync(update)).rejects.toMatchObject({ code: "EPERM" }),
      );

      expect(lockSpy).toHaveBeenCalledTimes(6);
      expect(update).not.toHaveBeenCalled();
    }),
  );

const doesNotRetryEpermOnOtherPlatforms = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      setPlatform("linux");
      yield* writeAuthJson({});
      const backend = new FileAuthStorageBackend(authJsonPath);
      const lockSpy = vi.spyOn(lockfile, "lock").mockRejectedValueOnce(eperm());

      yield* awaited(
        expect(
          backend.withLockAsync(() => effectRunPromise(awaited({ result: undefined }))),
        ).rejects.toMatchObject({
          code: "EPERM",
        }),
      );
      expect(lockSpy).toHaveBeenCalledTimes(1);
    }),
  );

const retriesTransientEpermOnWindowsSync = () =>
  runTest(
    Effect.gen(function* () {
      setPlatform("win32");
      yield* writeAuthJson({});
      const backend = new FileAuthStorageBackend(authJsonPath);
      const release = vi.fn();
      const lockSpy = vi
        .spyOn(lockfile, "lockSync")
        .mockImplementationOnce(() => {
          throw eperm();
        })
        .mockReturnValueOnce(release);
      const update = vi.fn(() => ({ result: undefined }));

      backend.withLock(update);

      expect(lockSpy).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
    }),
  );

describe("Windows EPERM on lock acquisition", () => {
  afterEach(() => {
    setPlatform(originalPlatform);
  });

  test("retries transient EPERM on Windows (async)", retriesTransientEpermOnWindowsAsync);

  test(
    "surfaces persistent EPERM on Windows after a bounded number of retries (async)",
    surfacesPersistentEpermOnWindowsAfterA,
  );

  test("does not retry EPERM on other platforms (async)", doesNotRetryEpermOnOtherPlatforms);

  test("retries transient EPERM on Windows (sync)", retriesTransientEpermOnWindowsSync);
});
