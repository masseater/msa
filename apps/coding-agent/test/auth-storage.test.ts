import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import platform from "../src/core/platform/index.ts";
const { withEnv } = platform;

const {
  awaited,
  currentTimeMillis,
  fromJsonText,
  joinPath,
  makeDirectory,
  randomSuffixSync,
  readTextFile,
  removePath,
  runTest,
  tempPath,
  writeJsonFile,
  writeTextFile,
} = testing;

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

const oauthCredential = () => ({
  access: "access-token",
  expires: currentTimeMillis() + 60_000,
  refresh: "refresh-token",
  type: "oauth" as const,
});

interface ReadCase {
  readonly env?: Record<string, string>;
  readonly exact: boolean;
  readonly expected: () => Record<string, unknown>;
  readonly name: string;
  readonly stored: () => { memory: boolean; credentials: Record<string, unknown> };
}

const readCases: readonly ReadCase[] = [
  {
    env: { TEST_AUTH_STORAGE_KEY: "environment-key" },
    exact: true,
    expected: () => ({ key: "environment-key", type: "api_key" }),
    name: "reads and resolves stored API-key credentials",
    stored: () => ({
      credentials: {
        "anthropic-api": { key: "$TEST_AUTH_STORAGE_KEY", type: "api_key" as const },
      },
      memory: false,
    }),
  },
  {
    exact: true,
    expected: () => ({ key: "command-key", type: "api_key" }),
    name: "resolves command-backed API-key credentials",
    stored: () => ({
      credentials: {
        "anthropic-api": { key: "!printf 'command-key'", type: "api_key" as const },
      },
      memory: false,
    }),
  },
  {
    exact: true,
    expected: () => oauthCredential(),
    name: "returns OAuth credentials unchanged",
    stored: () => ({ credentials: { "anthropic-api": oauthCredential() }, memory: true }),
  },
  {
    exact: false,
    expected: () => ({
      env: { REGION: "test-region", SCOPED_KEY: "scoped-value" },
      key: "scoped-value",
    }),
    name: "credential-scoped env takes precedence and remains inspectable",
    stored: () => ({
      credentials: {
        "anthropic-api": {
          env: { REGION: "test-region", SCOPED_KEY: "scoped-value" },
          key: "$SCOPED_KEY",
          type: "api_key" as const,
        },
      },
      memory: false,
    }),
  },
];

const readsStoredCredential = ({ env, exact, expected, stored }: ReadCase) =>
  runTest(
    Effect.gen(function* () {
      const { credentials, memory } = stored();
      if (!memory) yield* writeAuthJson(credentials);
      const storage = memory
        ? AuthStorage.inMemory(credentials as never)
        : AuthStorage.create(authJsonPath);
      const read = yield* awaited(storage.read("anthropic-api"));
      if (exact) expect(read).toEqual(expected());
      else expect(read).toMatchObject(expected());
    }).pipe(withEnv(env ?? {})),
  );

const modifyPersistsACredentialWhilePreservingUnrelated = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      yield* writeAuthJson({ "anthropic-api": { key: "old", type: "api_key" as const } });
      const storage = AuthStorage.create(authJsonPath);
      yield* writeAuthJson({
        "anthropic-api": { key: "old", type: "api_key" as const },
        openai: { key: "external", type: "api_key" as const },
      });

      yield* awaited(
        storage.modify("anthropic-api", () =>
          effectRunPromise(awaited({ key: "new", type: "api_key" as const })),
        ),
      );

      expect(yield* fromJsonText(yield* readTextFile(authJsonPath))).toEqual({
        "anthropic-api": { key: "new", type: "api_key" as const },
        openai: { key: "external", type: "api_key" as const },
      });
    }),
  );

const modifyWithUndefinedLeavesTheCurrentCredential = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      yield* writeAuthJson({ "anthropic-api": { key: "stored", type: "api_key" as const } });
      const storage = AuthStorage.create(authJsonPath);
      expect(
        yield* awaited(storage.modify("anthropic-api", () => effectRunPromise(awaited(undefined)))),
      ).toEqual({
        key: "stored",
        type: "api_key" as const,
      });
      expect(yield* awaited(storage.read("anthropic-api"))).toEqual({
        key: "stored",
        type: "api_key" as const,
      });
    }),
  );

const deleteRemovesOneCredentialWhilePreservingOthers = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeAuthJson({
        "anthropic-api": { key: "anthropic-key", type: "api_key" as const },
        openai: { key: "openai-key", type: "api_key" as const },
      });
      const storage = AuthStorage.create(authJsonPath);
      yield* writeAuthJson({
        "anthropic-api": { key: "anthropic-key", type: "api_key" as const },
        openai: { key: "openai-key", type: "api_key" as const },
        opencode: { key: "external-key", type: "api_key" as const },
      });
      yield* awaited(storage.delete("anthropic-api"));
      yield* awaited(
        expect(storage.list()).resolves.toEqual([
          { providerId: "openai", type: "api_key" as const },
          { providerId: "opencode", type: "api_key" as const },
        ]),
      );
      expect(yield* awaited(storage.read("anthropic-api"))).toBeUndefined();
      expect(yield* awaited(storage.read("openai"))).toEqual({
        key: "openai-key",
        type: "api_key" as const,
      });
      expect(yield* awaited(storage.read("opencode"))).toEqual({
        key: "external-key",
        type: "api_key" as const,
      });
    }),
  );

const inMemoryStorageImplementsTheSameCredential = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const storage = AuthStorage.inMemory({
        "anthropic-api": { key: "initial", type: "api_key" as const },
      });
      expect(yield* awaited(storage.read("anthropic-api"))).toEqual({
        key: "initial",
        type: "api_key" as const,
      });
      yield* awaited(
        storage.modify("anthropic-api", () =>
          effectRunPromise(awaited({ key: "updated", type: "api_key" as const })),
        ),
      );
      expect(yield* awaited(storage.read("anthropic-api"))).toEqual({
        key: "updated",
        type: "api_key" as const,
      });
      yield* awaited(storage.delete("anthropic-api"));
      yield* awaited(expect(storage.list()).resolves.toEqual([]));
    }),
  );

const doesNotOverwriteMalformedAuthFiles = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      yield* writeAuthJson({ "anthropic-api": { key: "stored", type: "api_key" as const } });
      const storage = AuthStorage.create(authJsonPath);
      yield* writeTextFile(authJsonPath, "{invalid-json");
      yield* awaited(
        expect(
          storage.modify("openai", () =>
            effectRunPromise(awaited({ key: "new", type: "api_key" as const })),
          ),
        ).rejects.toThrow(),
      );
      expect(yield* readTextFile(authJsonPath)).toBe("{invalid-json");
    }),
  );

describe("AuthStorage", () => {
  test.each(readCases)("$name", readsStoredCredential);

  test(
    "modify persists a credential while preserving unrelated external edits",
    modifyPersistsACredentialWhilePreservingUnrelated,
  );

  test(
    "modify with undefined leaves the current credential unchanged",
    modifyWithUndefinedLeavesTheCurrentCredential,
  );

  test(
    "delete removes one credential while preserving others",
    deleteRemovesOneCredentialWhilePreservingOthers,
  );

  test(
    "in-memory storage implements the same credential-store behavior",
    inMemoryStorageImplementsTheSameCredential,
  );

  test("does not overwrite malformed auth files", doesNotOverwriteMalformedAuthFiles);
});
