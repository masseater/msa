import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { InMemoryModelsStore } from "@msa/ai";
import {
  awaited,
  runTest,
  currentTimeMillis,
  toJsonText,
  randomSuffixSync,
  writeTextFile,
  pathExists,
  joinPath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { parseArgs } from "../src/cli/args.ts";
import {
  checkProviderAuth,
  createAuthCheckModelRuntime,
  getProviderCredential,
} from "../src/cli/auth-check.ts";
import { parseAuthCommand } from "../src/cli/auth-command.ts";
import { AuthStorage, ReadOnlyAuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

const tempDir = joinPath(
  tmpdir(),
  `msa-test-auth-check-${currentTimeMillis()}-${randomSuffixSync()}`,
);

function createRuntime(credentials: AuthStorage | ReadOnlyAuthStorage): Promise<ModelRuntime> {
  return runTest(
    awaited(
      ModelRuntime.create({
        credentials,
        modelsPath: null,
        modelsStore: new InMemoryModelsStore(),
        allowModelNetwork: false,
        refreshOnCreate: false,
      }),
    ),
  );
}

describe("auth check command", () => {
  beforeEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
  });

  test("reports a configured provider as ready", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          createRuntime(
            AuthStorage.inMemory({ openai: { type: "api_key" as const, key: "test-key" } }),
          ),
        );

        yield* awaited(
          expect(checkProviderAuth(parseArgs(["--provider", "openai"]), runtime)).resolves.toEqual({
            status: "ready",
            provider: "openai",
            authType: "api_key",
          }),
        );
      }),
    ));

  test("resolves the provider from --model", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          createRuntime(
            AuthStorage.inMemory({ openai: { type: "api_key" as const, key: "test-key" } }),
          ),
        );

        yield* awaited(
          expect(
            checkProviderAuth(parseArgs(["--model", "openai/gpt-5.5"]), runtime),
          ).resolves.toEqual({
            status: "ready",
            provider: "openai",
            authType: "api_key",
          }),
        );
        yield* awaited(
          expect(
            checkProviderAuth(parseArgs(["--provider", "openai", "--model", "gpt-5.5"]), runtime),
          ).resolves.toMatchObject({ status: "ready", provider: "openai" }),
        );
      }),
    ));

  test("reads credentials without refreshing OAuth when requested", () =>
    runTest(
      Effect.gen(function* () {
        const apiCredentials = AuthStorage.inMemory({
          openai: { type: "api_key" as const, key: "test-key" },
        });
        const apiRuntime = yield* awaited(createRuntime(apiCredentials));
        yield* awaited(
          expect(
            getProviderCredential("openai", apiRuntime, apiCredentials, { refresh: false }),
          ).resolves.toBe("test-key"),
        );

        const credentials = AuthStorage.inMemory({
          "openai-codex": {
            type: "oauth" as const,
            access: "old-token",
            refresh: "refresh-token",
            expires: 0,
          },
        });
        const oauthRuntime = yield* awaited(createRuntime(credentials));
        const oauth = oauthRuntime.getProvider("openai-codex")?.auth.oauth;
        if (!(oauth !== undefined))
          throw new Error("OpenAI Codex OAuth provider is not registered");
        const refresh = vi.fn(oauth.refresh);
        oauth.refresh = refresh;

        yield* awaited(
          expect(
            getProviderCredential("openai-codex", oauthRuntime, credentials, { refresh: false }),
          ).resolves.toBe("old-token"),
        );
        expect(refresh).not.toHaveBeenCalled();
      }),
    ));

  test("refreshes OAuth by default", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const credentials = AuthStorage.inMemory({
          "openai-codex": {
            type: "oauth" as const,
            access: "old-token",
            refresh: "refresh-token",
            expires: 0,
          },
        });
        const runtime = yield* awaited(createRuntime(credentials));
        const oauth = runtime.getProvider("openai-codex")?.auth.oauth;
        if (!(oauth !== undefined))
          throw new Error("OpenAI Codex OAuth provider is not registered");
        const refresh = vi.fn(() =>
          effectRunPromise(
            awaited({
              type: "oauth" as const,
              access: "fresh-token",
              refresh: "refresh-token",
              expires: currentTimeMillis() + 60 * 60 * 1000,
            }),
          ),
        );
        oauth.refresh = refresh;

        yield* awaited(
          expect(
            checkProviderAuth(parseArgs(["--provider", "openai-codex"]), runtime, {
              refresh: true,
            }),
          ).resolves.toMatchObject({
            status: "ready",
          }),
        );
        expect(refresh).toHaveBeenCalledOnce();
      }),
    ));

  test("reports an unknown provider as not ready", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(createRuntime(AuthStorage.inMemory()));

        yield* awaited(
          expect(
            checkProviderAuth(parseArgs(["--provider", "not-installed"]), runtime),
          ).resolves.toEqual({
            status: "not_ready",
            provider: "not-installed",
            reason: "provider_not_found",
          }),
        );
      }),
    ));

  test("does not treat an unresolved stored environment reference as configured", () =>
    runTest(
      Effect.gen(function* () {
        const authPath = joinPath(tempDir, "auth.json");
        yield* writeTextFile(
          authPath,
          yield* toJsonText({
            openai: { type: "api_key" as const, key: "$MISSING_AUTH_CHECK_KEY" },
          }),
        );
        const runtime = yield* awaited(createRuntime(new ReadOnlyAuthStorage(authPath)));

        yield* awaited(
          expect(checkProviderAuth(parseArgs(["--provider", "openai"]), runtime)).resolves.toEqual({
            status: "not_ready",
            provider: "openai",
            reason: "credentials_not_configured",
          }),
        );
      }),
    ));

  test("reports malformed auth state as invalid", () =>
    runTest(
      Effect.gen(function* () {
        const authPath = joinPath(tempDir, "auth.json");
        yield* writeTextFile(authPath, "{invalid-json");
        const runtime = yield* awaited(createRuntime(new ReadOnlyAuthStorage(authPath)));

        yield* awaited(
          expect(checkProviderAuth(parseArgs(["--provider", "openai"]), runtime)).resolves.toEqual({
            status: "invalid",
            provider: "openai",
            reason: "invalid_state",
          }),
        );
      }),
    ));

  test("does not create an auth file or its parent directory", () =>
    runTest(
      Effect.gen(function* () {
        const authPath = joinPath(tempDir, "agent", "auth.json");
        const runtime = yield* awaited(createRuntime(new ReadOnlyAuthStorage(authPath)));

        yield* awaited(
          expect(
            checkProviderAuth(parseArgs(["--provider", "openai"]), runtime),
          ).resolves.toMatchObject({
            status: "not_ready",
            reason: "credentials_not_configured",
          }),
        );
        expect(yield* pathExists(authPath)).toBe(false);
        expect(yield* pathExists(joinPath(tempDir, "agent"))).toBe(false);
      }),
    ));

  test("accepts optional JSON output, credential output, and --no-refresh", () => {
    expect(parseAuthCommand(["auth", "check", "--provider", "openai"])).toEqual({
      kind: "check" as const,
      args: ["--provider", "openai"],
      json: false,
      credentials: false,
      noRefresh: false,
    });
    expect(
      parseAuthCommand([
        "auth",
        "check",
        "--json",
        "--credentials",
        "--no-refresh",
        "--provider",
        "openai",
      ]),
    ).toEqual({
      kind: "check" as const,
      args: ["--provider", "openai"],
      json: true,
      credentials: true,
      noRefresh: true,
    });
  });

  test("creates an auth-check runtime without catalog storage", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(createAuthCheckModelRuntime(AuthStorage.inMemory()));
        expect(runtime.getProvider("openai")).toBeDefined();
      }),
    ));
});
