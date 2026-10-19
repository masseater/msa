import {
  abortController,
  awaited,
  changeMode,
  fromJsonText,
  joinPath,
  makeDirectory,
  pathExists,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  testRuntime,
  tempPath,
  writeJsonFile,
} from "@msa/testing";
import { Effect, FileSystem } from "effect";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage, FileAuthStorageBackend } from "../src/core/auth-storage.ts";

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
  Effect.flatMap(testRuntime.contextEffect, (context) =>
    Effect.provide(
      Effect.flatMap(FileSystem.FileSystem, (service) => service.stat(path)).pipe(
        Effect.orDie,
        Effect.map((info) => Number(info.mode) & 0o777),
      ),
      context,
    ),
  );

describe("AuthStorage file permissions", () => {
  test.skipIf(process.platform === "win32")(
    "creates new auth files with owner-only permissions",
    () =>
      runTest(
        Effect.gen(function* () {
          AuthStorage.create(authJsonPath);

          expect(yield* fileMode(authJsonPath)).toBe(0o600);
        }),
      ),
  );

  test.skipIf(process.platform === "win32")("preserves the mode of an existing auth file", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* writeAuthJson({ "anthropic-api": { type: "api_key" as const, key: "old" } });
        yield* changeMode(authJsonPath, 0o660);
        const storage = AuthStorage.create(authJsonPath);

        yield* awaited(
          storage.modify("anthropic-api", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "new" })),
          ),
        );

        expect(yield* fileMode(authJsonPath)).toBe(0o660);
      }),
    ),
  );
});

describe("Windows EPERM on lock acquisition", () => {
  const eperm = () => Object.assign(new Error("operation not permitted"), { code: "EPERM" });
  const originalPlatform = process.platform;
  const setPlatform = (platform: NodeJS.Platform) =>
    Object.defineProperty(process, "platform", { value: platform, configurable: true });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  test("retries transient EPERM on Windows (async)", () =>
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
    ));

  test("surfaces persistent EPERM on Windows after a bounded number of retries (async)", () =>
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
    ));

  test("does not retry EPERM on other platforms (async)", () =>
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
    ));

  test("retries transient EPERM on Windows (sync)", () =>
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
    ));
});

describe("AuthStorage cancellation before a lock is held", () => {
  test("pre-aborted file operations do not create the backing file or run the mutation", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const backend = new FileAuthStorageBackend(authJsonPath);
        const controller = abortController();
        controller.abort();
        const update = vi.fn(() =>
          effectRunPromise(awaited({ result: undefined, next: JSON.stringify({}) })),
        );

        yield* awaited(
          expect(
            backend.withLockAsync(update, { signal: controller.signal }),
          ).rejects.toMatchObject({
            name: "AbortError",
          }),
        );
        expect(update).not.toHaveBeenCalled();
        expect(yield* pathExists(authJsonPath)).toBe(false);
      }),
    ));

  test("aborts while waiting for a held file lock without running the mutation later", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* writeAuthJson({ "anthropic-api": { type: "api_key" as const, key: "stored" } });
        const release = yield* awaited(lockfile.lock(authJsonPath, { realpath: false }));
        const backend = new FileAuthStorageBackend(authJsonPath);
        const controller = abortController();
        const update = vi.fn(() =>
          effectRunPromise(awaited({ result: undefined, next: JSON.stringify({}) })),
        );
        const pending = backend.withLockAsync(update, { signal: controller.signal });

        yield* Effect.sleep(10);
        controller.abort();
        yield* awaited(expect(pending).rejects.toMatchObject({ name: "AbortError" }));
        expect(update).not.toHaveBeenCalled();

        yield* awaited(release());
        yield* Effect.sleep(150);
        expect(update).not.toHaveBeenCalled();
        expect(yield* fromJsonText(yield* readTextFile(authJsonPath))).toEqual({
          "anthropic-api": { type: "api_key" as const, key: "stored" },
        });
      }),
    ));

  test("releases a file lock acquired concurrently with cancellation before mutation", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* writeAuthJson({ "anthropic-api": { type: "api_key" as const, key: "stored" } });
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
          effectRunPromise(awaited({ result: undefined, next: JSON.stringify({}) })),
        );

        yield* awaited(
          expect(
            backend.withLockAsync(update, { signal: controller.signal }),
          ).rejects.toMatchObject({
            name: "AbortError",
          }),
        );
        yield* Effect.sleep(0);
        expect(update).not.toHaveBeenCalled();
        expect(release).toHaveBeenCalledTimes(1);
      }),
    ));
});
