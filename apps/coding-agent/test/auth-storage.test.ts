import {
  awaited,
  currentTimeMillis,
  fromJsonText,
  joinPath,
  makeDirectory,
  readTextFile,
  randomSuffixSync,
  removePath,
  runTest,
  tempPath,
  writeJsonFile,
  writeTextFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { withEnv } from "../src/core/process-env.ts";

const dir = tempPath(`msa-auth-storage-${randomSuffixSync()}`);
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

describe("AuthStorage", () => {
  test("reads and resolves stored API-key credentials", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeAuthJson({
          anthropic: { type: "api_key" as const, key: "$TEST_AUTH_STORAGE_KEY" },
        });
        const storage = AuthStorage.create(authJsonPath);
        expect(yield* awaited(storage.read("anthropic"))).toEqual({
          type: "api_key" as const,
          key: "environment-key",
        });
      }).pipe(withEnv({ TEST_AUTH_STORAGE_KEY: "environment-key" })),
    ));

  test("resolves command-backed API-key credentials", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeAuthJson({
          anthropic: { type: "api_key" as const, key: "!printf 'command-key'" },
        });
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
        yield* writeAuthJson({
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

  test("modify persists a credential while preserving unrelated external edits", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "old" } });
        const storage = AuthStorage.create(authJsonPath);
        yield* writeAuthJson({
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

        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
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

  test("delete removes one credential while preserving others", () =>
    runTest(
      Effect.gen(function* () {
        yield* writeAuthJson({
          anthropic: { type: "api_key" as const, key: "anthropic-key" },
          openai: { type: "api_key" as const, key: "openai-key" },
        });
        const storage = AuthStorage.create(authJsonPath);
        yield* writeAuthJson({
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

  test("does not overwrite malformed auth files", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        yield* writeAuthJson({ anthropic: { type: "api_key" as const, key: "stored" } });
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
