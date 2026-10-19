import {
  abortController,
  awaited,
  fromJsonText,
  joinPath,
  makeDirectory,
  readTextFile,
  randomSuffixSync,
  removePath,
  runTest,
  tempPath,
  writeJsonFile,
} from "@msa/testing";
import { Effect } from "effect";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage, FileAuthStorageBackend } from "../src/core/auth-storage.ts";

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

describe("AuthStorage locking", () => {
  test("serializes concurrent modifications", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* writeAuthJson({});
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

  test("coalesces file reloads across concurrent readers and storage instances", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "old" } });
        const first = AuthStorage.create(authJsonPath);
        const second = AuthStorage.create(authJsonPath);
        const lockSpy = vi.spyOn(lockfile, "lock");

        yield* writeAuthJson({
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

        const otherPath = joinPath(dir, "other-auth.json");
        yield* writeJsonFile(otherPath, { other: { type: "api_key" as const, key: "other-key" } });
        const otherFirst = AuthStorage.create(otherPath);
        const otherSecond = AuthStorage.create(otherPath);
        yield* awaited(otherFirst.read("other"));
        yield* awaited(otherSecond.read("other"));
        yield* awaited(otherFirst.list());
        expect(lockSpy).toHaveBeenCalledTimes(1);

        const third = AuthStorage.create(authJsonPath);
        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "newest" } });
        const [firstReload, thirdReload] = yield* awaited(
          Promise.all([first.read("anthropic"), third.read("anthropic")]),
        );
        expect(firstReload).toEqual({ type: "api_key" as const, key: "newest" });
        expect(thirdReload).toEqual({ type: "api_key" as const, key: "newest" });
        expect(lockSpy).toHaveBeenCalledTimes(2);
      }),
    ));

  test("does not write after lock acquisition failure and recovers on retry", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
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
        expect(yield* awaited(storage.read("openai"))).toBeUndefined();

        lockSpy.mockRestore();
        yield* awaited(
          storage.modify("openai", () =>
            effectRunPromise(awaited({ type: "api_key" as const, key: "new" })),
          ),
        );
        expect(yield* awaited(storage.read("anthropic"))).toEqual({
          type: "api_key" as const,
          key: "stored",
        });
        expect(yield* awaited(storage.read("openai"))).toEqual({
          type: "api_key" as const,
          key: "new",
        });
      }),
    ));

  test("retries a briefly contended file lock", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
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

  test("surfaces a compromised file storage lock", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
        const backend = new FileAuthStorageBackend(authJsonPath);
        const update = vi.fn(() =>
          effectRunPromise(awaited({ result: undefined, next: JSON.stringify({}) })),
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
          anthropic: { type: "api_key" as const, key: "stored" },
        });
      }),
    ));
});
