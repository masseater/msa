import { chmodSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { type CredentialStore, createModels, type Provider } from "@msa/ai";
import {
  awaited,
  runTest,
  currentTimeMillis,
  abortController,
  toJsonText,
  fromJsonText,
  randomSuffixSync,
  readTextFile,
  writeTextFile,
  pathExists,
  joinPath,
} from "@msa/testing";
import { Effect } from "effect";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage, FileAuthStorageBackend } from "../src/core/auth-storage.ts";
import { deleteEnv, readEnv, writeEnv } from "../src/core/process-env.ts";

describe("AuthStorage", () => {
  const tempDir = joinPath(
    tmpdir(),
    `msa-test-auth-storage-${currentTimeMillis()}-${randomSuffixSync()}`,
  );
  const authJsonPath = joinPath(tempDir, "auth.json");

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        yield* Effect.void;
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
        mkdirSync(tempDir, { recursive: true });
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        yield* Effect.void;
        if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
        vi.restoreAllMocks();
      }),
    ),
  );

  function writeAuthJson(data: Record<string, unknown>): void {
    writeFileSync(authJsonPath, JSON.stringify(data));
  }

  test("reads and resolves stored API-key credentials", () =>
    runTest(
      Effect.gen(function* () {
        const original = readEnv("TEST_AUTH_STORAGE_KEY");
        writeEnv("TEST_AUTH_STORAGE_KEY", "environment-key");
        try {
          writeAuthJson({ anthropic: { type: "api_key" as const, key: "$TEST_AUTH_STORAGE_KEY" } });
          const storage = AuthStorage.create(authJsonPath);
          expect(yield* awaited(storage.read("anthropic"))).toEqual({
            type: "api_key" as const,
            key: "environment-key",
          });
        } finally {
          if (original === undefined) deleteEnv("TEST_AUTH_STORAGE_KEY");
          else writeEnv("TEST_AUTH_STORAGE_KEY", original);
        }
      }),
    ));

  test("resolves command-backed API-key credentials", () =>
    runTest(
      Effect.gen(function* () {
        writeAuthJson({ anthropic: { type: "api_key" as const, key: "!printf 'command-key'" } });
        const storage = AuthStorage.create(authJsonPath);
        expect(yield* awaited(storage.read("anthropic"))).toEqual({
          type: "api_key" as const,
          key: "command-key",
        });
      }),
    ));

  test("returns OAuth credentials unchanged", () =>
    runTest(
      Effect.gen(function* () {
        const credential = {
          type: "oauth" as const,
          access: "access-token",
          refresh: "refresh-token",
          expires: currentTimeMillis() + 60_000,
        };
        const storage = AuthStorage.inMemory({ anthropic: credential });
        expect(yield* awaited(storage.read("anthropic"))).toEqual(credential);
      }),
    ));

  test("credential-scoped env takes precedence and remains inspectable", () =>
    runTest(
      Effect.gen(function* () {
        writeAuthJson({
          anthropic: {
            type: "api_key" as const,
            key: "$SCOPED_KEY",
            env: { SCOPED_KEY: "scoped-value", REGION: "test-region" },
          },
        });
        const storage = AuthStorage.create(authJsonPath);
        expect(yield* awaited(storage.read("anthropic"))).toMatchObject({
          key: "scoped-value",
          env: { SCOPED_KEY: "scoped-value", REGION: "test-region" },
        });
      }),
    ));

  test("coalesces file reloads across concurrent readers and storage instances", () =>
    runTest(
      Effect.gen(function* () {
        writeAuthJson({ anthropic: { type: "api_key" as const, key: "old" } });
        const first = AuthStorage.create(authJsonPath);
        const second = AuthStorage.create(authJsonPath);
        const lockSpy = vi.spyOn(lockfile, "lock");

        writeAuthJson({
          anthropic: { type: "api_key" as const, key: "new" },
          openai: { type: "api_key" as const, key: "openai-key" },
        });

        const [anthropic, openai, credentials] = yield* awaited(
          Promise.all([
            first.read("anthropic", { signal: abortController().signal }),
            second.read("openai", { signal: abortController().signal }),
            first.list({ signal: abortController().signal }),
          ]),
        );
        expect(anthropic).toEqual({ type: "api_key" as const, key: "new" });
        expect(openai).toEqual({ type: "api_key" as const, key: "openai-key" });
        expect(credentials).toEqual([
          { providerId: "anthropic", type: "api_key" as const },
          { providerId: "openai", type: "api_key" as const },
        ]);
        expect(lockSpy).toHaveBeenCalledTimes(1);

        yield* awaited(
          expect(second.read("anthropic")).resolves.toEqual({
            type: "api_key" as const,
            key: "new",
          }),
        );
        expect(lockSpy).toHaveBeenCalledTimes(1);

        const otherPath = joinPath(tempDir, "other-auth.json");
        writeFileSync(
          otherPath,
          yield* toJsonText({ other: { type: "api_key" as const, key: "other-key" } }),
        );
        const otherFirst = AuthStorage.create(otherPath);
        const otherSecond = AuthStorage.create(otherPath);
        yield* awaited(otherFirst.read("other"));
        yield* awaited(otherSecond.read("other"));
        yield* awaited(otherFirst.list());
        expect(lockSpy).toHaveBeenCalledTimes(1);

        const third = AuthStorage.create(authJsonPath);
        writeAuthJson({ anthropic: { type: "api_key" as const, key: "newest" } });
        const [firstReload, thirdReload] = yield* awaited(
          Promise.all([first.read("anthropic"), third.read("anthropic")]),
        );
        expect(firstReload).toEqual({ type: "api_key" as const, key: "newest" });
        expect(thirdReload).toEqual({ type: "api_key" as const, key: "newest" });
        expect(lockSpy).toHaveBeenCalledTimes(2);
      }),
    ));

  test("keeps a coalesced reload alive while another credential reader is waiting", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        writeAuthJson({ anthropic: { type: "api_key" as const, key: "old" } });
        const storage = AuthStorage.create(authJsonPath);
        writeAuthJson({ anthropic: { type: "api_key" as const, key: "new" } });
        let grantLock: (() => void) | undefined;
        const lockGranted = new Promise<void>((resolve) => {
          grantLock = resolve;
        });
        const release = vi.fn(() => effectRunPromise(Effect.sync(() => {})));
        const lockSpy = vi.spyOn(lockfile, "lock").mockImplementation(() =>
          effectRunPromise(
            Effect.gen(function* () {
              yield* awaited(lockGranted);
              return yield* awaited(release);
            }),
          ),
        );
        const firstController = abortController();
        const secondController = abortController();
        const first = storage.read("anthropic", { signal: firstController.signal });
        const second = storage.read("anthropic", { signal: secondController.signal });

        firstController.abort();
        yield* awaited(expect(first).rejects.toMatchObject({ name: "AbortError" }));
        grantLock?.();
        yield* awaited(expect(second).resolves.toEqual({ type: "api_key" as const, key: "new" }));
        expect(lockSpy).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
      }),
    ));

  test.skipIf(process.platform === "win32")(
    "creates new auth files with owner-only permissions",
    () => {
      AuthStorage.create(authJsonPath);

      expect(statSync(authJsonPath).mode & 0o777).toBe(0o600);
    },
  );

  test.skipIf(process.platform === "win32")("preserves the mode of an existing auth file", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        writeAuthJson({ anthropic: { type: "api_key" as const, key: "old" } });
        chmodSync(authJsonPath, 0o660);
        const storage = AuthStorage.create(authJsonPath);

        yield* awaited(
          storage.modify("anthropic", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "new" })),
          ),
        );

        expect(statSync(authJsonPath).mode & 0o777).toBe(0o660);
      }),
    ),
  );

  test("modify persists a credential while preserving unrelated external edits", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        writeAuthJson({ anthropic: { type: "api_key" as const, key: "old" } });
        const storage = AuthStorage.create(authJsonPath);
        writeAuthJson({
          anthropic: { type: "api_key" as const, key: "old" },
          openai: { type: "api_key" as const, key: "external" },
        });

        yield* awaited(
          storage.modify("anthropic", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "new" })),
          ),
        );

        expect(yield* fromJsonText(yield* readTextFile(authJsonPath))).toEqual({
          anthropic: { type: "api_key" as const, key: "new" },
          openai: { type: "api_key" as const, key: "external" },
        });
      }),
    ));

  test("modify with undefined leaves the current credential unchanged", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
        const storage = AuthStorage.create(authJsonPath);
        expect(
          yield* awaited(storage.modify("anthropic", () => effectRunPromise(awaited(undefined)))),
        ).toEqual({
          type: "api_key" as const,
          key: "stored",
        });
        expect(yield* awaited(storage.read("anthropic"))).toEqual({
          type: "api_key" as const,
          key: "stored",
        });
      }),
    ));

  test("serializes concurrent modifications", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        writeAuthJson({});
        const first = AuthStorage.create(authJsonPath);
        const second = AuthStorage.create(authJsonPath);
        yield* awaited(
          Promise.all([
            first.modify("anthropic", () =>
              effectRunPromise(awaited({ type: "api_key" as const, key: "anthropic-key" })),
            ),
            second.modify("openai", () =>
              effectRunPromise(awaited({ type: "api_key" as const, key: "openai-key" })),
            ),
          ]),
        );
        expect(yield* fromJsonText(yield* readTextFile(authJsonPath))).toEqual({
          anthropic: { type: "api_key" as const, key: "anthropic-key" },
          openai: { type: "api_key" as const, key: "openai-key" },
        });
      }),
    ));

  test("delete removes one credential while preserving others", () =>
    runTest(
      Effect.gen(function* () {
        writeAuthJson({
          anthropic: { type: "api_key" as const, key: "anthropic-key" },
          openai: { type: "api_key" as const, key: "openai-key" },
        });
        const storage = AuthStorage.create(authJsonPath);
        writeAuthJson({
          anthropic: { type: "api_key" as const, key: "anthropic-key" },
          openai: { type: "api_key" as const, key: "openai-key" },
          opencode: { type: "api_key" as const, key: "external-key" },
        });
        yield* awaited(storage.delete("anthropic"));
        yield* awaited(
          expect(storage.list()).resolves.toEqual([
            { providerId: "openai", type: "api_key" as const },
            { providerId: "opencode", type: "api_key" as const },
          ]),
        );
        expect(yield* awaited(storage.read("anthropic"))).toBeUndefined();
        expect(yield* awaited(storage.read("openai"))).toEqual({
          type: "api_key" as const,
          key: "openai-key",
        });
        expect(yield* awaited(storage.read("opencode"))).toEqual({
          type: "api_key" as const,
          key: "external-key",
        });
      }),
    ));

  test("in-memory storage implements the same credential-store behavior", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const storage = AuthStorage.inMemory({
          anthropic: { type: "api_key" as const, key: "initial" },
        });
        expect(yield* awaited(storage.read("anthropic"))).toEqual({
          type: "api_key" as const,
          key: "initial",
        });
        yield* awaited(
          storage.modify("anthropic", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "updated" })),
          ),
        );
        expect(yield* awaited(storage.read("anthropic"))).toEqual({
          type: "api_key" as const,
          key: "updated",
        });
        yield* awaited(storage.delete("anthropic"));
        yield* awaited(expect(storage.list()).resolves.toEqual([]));
      }),
    ));

  test("does not write after lock acquisition failure and recovers on retry", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
        const storage = AuthStorage.create(authJsonPath);
        const lockSpy = vi
          .spyOn(lockfile, "lock")
          .mockRejectedValueOnce(new Error("lock unavailable"));

        yield* awaited(
          expect(
            storage.modify("openai", () =>
              effectRunPromise(awaited({ type: "api_key" as const, key: "new" })),
            ),
          ).rejects.toThrow("lock unavailable"),
        );
        expect(yield* fromJsonText(yield* readTextFile(authJsonPath))).toEqual({
          anthropic: { type: "api_key" as const, key: "stored" },
        });

        lockSpy.mockRestore();
        yield* awaited(
          storage.modify("openai", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "new" })),
          ),
        );
        expect(yield* fromJsonText(yield* readTextFile(authJsonPath))).toEqual({
          anthropic: { type: "api_key" as const, key: "stored" },
          openai: { type: "api_key" as const, key: "new" },
        });
      }),
    ));

  test("retries a briefly contended file lock", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
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
    ));

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
          writeAuthJson({});
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
          writeAuthJson({});
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
          writeAuthJson({});
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

    test("retries transient EPERM on Windows (sync)", () => {
      setPlatform("win32");
      writeAuthJson({});
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
    });
  });

  test("surfaces a compromised file storage lock", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
        const backend = new FileAuthStorageBackend(authJsonPath);
        const update = vi.fn(() =>
          effectRunPromise(awaited({ result: undefined, next: JSON.stringify({}) })),
        );
        const compromised = new Error("lock compromised");
        vi.spyOn(lockfile, "lock").mockImplementation((_file, options) =>
          effectRunPromise(
            Effect.gen(function* () {
              const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

              options?.onCompromised?.(compromised);
              return yield* awaited(() => effectRunPromise(Effect.sync(() => {})));
            }),
          ),
        );

        yield* awaited(expect(backend.withLockAsync(update)).rejects.toThrow(compromised));
        expect(update).not.toHaveBeenCalled();
        expect(yield* fromJsonText(yield* readTextFile(authJsonPath))).toEqual({
          anthropic: { type: "api_key" as const, key: "stored" },
        });
      }),
    ));

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

        writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
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
          anthropic: { type: "api_key" as const, key: "stored" },
        });
      }),
    ));

  test("releases a file lock acquired concurrently with cancellation before mutation", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
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

  test("holds the file lock until a cancelled active callback settles without committing it", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
        const backend = new FileAuthStorageBackend(authJsonPath);
        const controller = abortController();
        let markStarted: (() => void) | undefined;
        let finish: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const blocked = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const pending = backend.withLockAsync(
          () =>
            effectRunPromise(
              Effect.gen(function* () {
                markStarted?.();
                yield* awaited(blocked);
                return yield* awaited({
                  result: undefined,
                  next: yield* toJsonText({
                    openai: { type: "api_key" as const, key: "cancelled" },
                  }),
                });
              }),
            ),
          { signal: controller.signal },
        );

        yield* awaited(started);
        controller.abort();
        const competingMutation = vi.fn(() =>
          effectRunPromise(
            awaited({
              result: undefined,
              next: JSON.stringify({ opencode: { type: "api_key" as const, key: "committed" } }),
            }),
          ),
        );
        const competing = backend.withLockAsync(competingMutation);
        yield* Effect.sleep(20);
        expect(competingMutation).not.toHaveBeenCalled();

        finish?.();
        yield* awaited(expect(pending).rejects.toMatchObject({ name: "AbortError" }));
        yield* awaited(competing);
        expect(competingMutation).toHaveBeenCalledTimes(1);
        expect(yield* fromJsonText(yield* readTextFile(authJsonPath))).toEqual({
          opencode: { type: "api_key" as const, key: "committed" },
        });
      }),
    ));

  test("cancels a signalled credential read waiting for a held file lock", () =>
    runTest(
      Effect.gen(function* () {
        writeAuthJson({ anthropic: { type: "api_key" as const, key: "old" } });
        const storage = AuthStorage.create(authJsonPath);
        writeAuthJson({ anthropic: { type: "api_key" as const, key: "new-value" } });
        const release = yield* awaited(lockfile.lock(authJsonPath, { realpath: false }));
        const lockSpy = vi.spyOn(lockfile, "lock");
        const controller = abortController();
        const pending = storage.read("anthropic", { signal: controller.signal });

        yield* Effect.sleep(10);
        controller.abort();
        yield* awaited(expect(pending).rejects.toMatchObject({ name: "AbortError" }));
        yield* awaited(release());
        yield* Effect.sleep(150);
        expect(lockSpy).toHaveBeenCalledTimes(1);
        yield* awaited(
          expect(storage.read("anthropic")).resolves.toEqual({
            type: "api_key" as const,
            key: "new-value",
          }),
        );
      }),
    ));

  test("serializes in-memory mutations across providers", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const storage = AuthStorage.inMemory();
        let markStarted: (() => void) | undefined;
        let finish: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const blocked = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const first = storage.modify("anthropic", () =>
          effectRunPromise(
            Effect.gen(function* () {
              markStarted?.();
              yield* awaited(blocked);
              return yield* awaited({ type: "api_key" as const, key: "anthropic-key" });
            }),
          ),
        );
        yield* awaited(started);
        const secondMutation = vi.fn(() =>
          effectRunPromise(awaited({ type: "api_key" as const, key: "openai-key" })),
        );
        const second = storage.modify("openai", secondMutation);
        yield* Effect.sleep(0);
        expect(secondMutation).not.toHaveBeenCalled();

        finish?.();
        yield* awaited(Promise.all([first, second]));
        expect(yield* awaited(storage.read("anthropic"))).toEqual({
          type: "api_key" as const,
          key: "anthropic-key",
        });
        expect(yield* awaited(storage.read("openai"))).toEqual({
          type: "api_key" as const,
          key: "openai-key",
        });
      }),
    ));

  test("cancels a queued in-memory mutation without running it later", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const storage = AuthStorage.inMemory();
        let markStarted: (() => void) | undefined;
        let finish: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const blocked = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const first = storage.modify("anthropic", () =>
          effectRunPromise(
            Effect.gen(function* () {
              markStarted?.();
              yield* awaited(blocked);
              return yield* awaited({ type: "api_key" as const, key: "anthropic-key" });
            }),
          ),
        );
        yield* awaited(started);
        const controller = abortController();
        const secondMutation = vi.fn(() =>
          effectRunPromise(awaited({ type: "api_key" as const, key: "openai-key" })),
        );
        const second = storage.modify("openai", secondMutation, { signal: controller.signal });

        controller.abort();
        yield* awaited(expect(second).rejects.toMatchObject({ name: "AbortError" }));
        expect(secondMutation).not.toHaveBeenCalled();
        finish?.();
        yield* awaited(first);
        yield* Effect.sleep(0);
        expect(secondMutation).not.toHaveBeenCalled();
        expect(yield* awaited(storage.read("openai"))).toBeUndefined();
      }),
    ));

  test("preserves the stored credential after cancelling an active refresh mutation", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const previous = {
          type: "oauth" as const,
          access: "expired",
          refresh: "refresh-token",
          expires: 0,
        };
        const storage = AuthStorage.inMemory({ oauth: previous });
        const controller = abortController();
        let markStarted: (() => void) | undefined;
        let finish: (() => void) | undefined;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const blocked = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const pending = storage.modify(
          "oauth",
          () =>
            effectRunPromise(
              Effect.gen(function* () {
                markStarted?.();
                yield* awaited(blocked);
                return yield* awaited({
                  ...previous,
                  access: "refreshed",
                  expires: currentTimeMillis() + 60_000,
                });
              }),
            ),
          { signal: controller.signal },
        );

        yield* awaited(started);
        controller.abort();
        yield* awaited(expect(pending).rejects.toMatchObject({ name: "AbortError" }));
        const competingMutation = vi.fn(() =>
          effectRunPromise(awaited({ type: "api_key" as const, key: "other" })),
        );
        const competing = storage.modify("other", competingMutation);
        yield* Effect.sleep(0);
        expect(competingMutation).not.toHaveBeenCalled();

        finish?.();
        yield* awaited(competing);
        expect(competingMutation).toHaveBeenCalledTimes(1);
        expect(yield* awaited(storage.read("oauth"))).toEqual(previous);
      }),
    ));

  test("translates a credential-store refresh failure and allows a later retry", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const providerId = "oauth-provider";
        const base = AuthStorage.inMemory({
          [providerId]: {
            type: "oauth" as const,
            access: "expired-access",
            refresh: "refresh-token",
            expires: 0,
          },
        });
        let failNextModify = true;
        const credentials: CredentialStore = {
          read: (id) => base.read(id),
          list: () => base.list(),
          modify: (id, fn) => {
            if (failNextModify) {
              failNextModify = false;
              return Promise.reject(new Error("credential store unavailable"));
            }
            return base.modify(id, fn);
          },
          delete: (id) => base.delete(id),
        };
        const provider: Provider = {
          id: providerId,
          name: "OAuth Provider",
          auth: {
            oauth: {
              name: "OAuth",
              login: () =>
                effectRunPromise(
                  Effect.sync(() => {
                    throw new Error("not used");
                  }),
                ),
              refresh: (credential) =>
                effectRunPromise(
                  awaited({
                    ...credential,
                    access: "refreshed-access",
                    expires: currentTimeMillis() + 60_000,
                  }),
                ),
              toAuth: (credential) => effectRunPromise(awaited({ apiKey: credential.access })),
            },
          },
          getModels: () => [],
          stream: () => {
            throw new Error("not used");
          },
          streamSimple: () => {
            throw new Error("not used");
          },
        };
        const models = createModels({ credentials });
        models.setProvider(provider);

        yield* awaited(expect(models.getAuth(providerId)).rejects.toMatchObject({ code: "auth" }));
        yield* awaited(
          expect(models.getAuth(providerId)).resolves.toMatchObject({
            auth: { apiKey: "refreshed-access" },
          }),
        );
      }),
    ));

  test("does not overwrite malformed auth files", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
        const storage = AuthStorage.create(authJsonPath);
        yield* writeTextFile(authJsonPath, "{invalid-json");
        yield* awaited(
          expect(
            storage.modify("openai", () =>
              effectRunPromise(awaited({ type: "api_key" as const, key: "new" })),
            ),
          ).rejects.toThrow(),
        );
        expect(yield* readTextFile(authJsonPath)).toBe("{invalid-json");
      }),
    ));
});
