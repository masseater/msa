import {
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
} from "@msa/testing";
import { Effect } from "effect";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage, FileAuthStorageBackend } from "../src/core/auth-storage.ts";

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

describe("AuthStorage cancellation while a lock is held", () => {
  test("keeps a coalesced reload alive while another credential reader is waiting", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "old" } });
        const storage = AuthStorage.create(authJsonPath);
        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "new" } });
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
        const first = storage.read("anthropic", { signal: firstController.signal });
        const second = storage.read("anthropic", { signal: secondController.signal });

        firstController.abort();
        yield* awaited(expect(first).rejects.toMatchObject({ name: "AbortError" }));
        lockGranted.resolve(undefined);
        yield* awaited(expect(second).resolves.toEqual({ type: "api_key" as const, key: "new" }));
        expect(lockSpy).toHaveBeenCalledTimes(1);
        expect(release).toHaveBeenCalledTimes(1);
      }),
    ));

  test("holds the file lock until a cancelled active callback settles without committing it", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
        const backend = new FileAuthStorageBackend(authJsonPath);
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
                  result: undefined,
                  next: yield* toJsonText({
                    openai: { type: "api_key" as const, key: "cancelled" },
                  }),
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
                result: undefined,
                next: yield* toJsonText({
                  opencode: { type: "api_key" as const, key: "committed" },
                }),
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
          opencode: { type: "api_key" as const, key: "committed" },
        });
      }),
    ));

  test("cancels a signalled credential read waiting for a held file lock", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "old" } });
        const storage = AuthStorage.create(authJsonPath);
        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "new-value" } });
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
});

describe("AuthStorage in-memory mutation queue", () => {
  test("serializes in-memory mutations across providers", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const storage = AuthStorage.inMemory();
        const started = deferredPromise<void>();
        const blocked = deferredPromise<void>();
        const first = storage.modify("anthropic", () =>
          effectRunPromise(
            Effect.gen(function* () {
              started.resolve(undefined);
              yield* awaited(blocked.promise);
              return yield* awaited({ type: "api_key" as const, key: "anthropic-key" });
            }),
          ),
        );
        yield* awaited(started.promise);
        const secondMutation = vi.fn(() =>
          effectRunPromise(awaited({ type: "api_key" as const, key: "openai-key" })),
        );
        const second = storage.modify("openai", secondMutation);
        yield* Effect.sleep(0);
        expect(secondMutation).not.toHaveBeenCalled();

        blocked.resolve(undefined);
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
        const started = deferredPromise<void>();
        const blocked = deferredPromise<void>();
        const first = storage.modify("anthropic", () =>
          effectRunPromise(
            Effect.gen(function* () {
              started.resolve(undefined);
              yield* awaited(blocked.promise);
              return yield* awaited({ type: "api_key" as const, key: "anthropic-key" });
            }),
          ),
        );
        yield* awaited(started.promise);
        const controller = abortController();
        const secondMutation = vi.fn(() =>
          effectRunPromise(awaited({ type: "api_key" as const, key: "openai-key" })),
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
      }),
    ));
});
