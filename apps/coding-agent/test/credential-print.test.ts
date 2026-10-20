import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test, vi } from "vite-plus/test";

import { parseArgs } from "../src/cli/args.ts";
import {
  AuthCommandError,
  getAuthCredential,
  isAuthCommandHelp,
  parseAuthCommand,
} from "../src/cli/auth-command.ts";
import { resolveCredentialForPrint } from "../src/cli/credential-print.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { main } from "../src/main.ts";

const { InMemoryModelsStore } = ai;

const { awaited, currentTimeMillis, runTest } = testing;

function createRuntime(credentials: AuthStorage): Promise<ModelRuntime> {
  return runTest(
    awaited(
      ModelRuntime.create({
        allowModelNetwork: false,
        credentials,
        modelsPath: null,
        modelsStore: new InMemoryModelsStore(),
      }),
    ),
  );
}

const printsAResolvedApiKey = () =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        createRuntime(
          AuthStorage.inMemory({ openai: { key: "test-api-key", type: "api_key" as const } }),
        ),
      );
      const args = parseArgs(["--provider", "openai"]);

      yield* awaited(
        expect(resolveCredentialForPrint(args, runtime, "api_key")).resolves.toBe("test-api-key"),
      );
    }),
  );

const resolvesModelWithoutProviderOnlyAmongCatalog = () =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        createRuntime(
          AuthStorage.inMemory({
            "anthropic-api": { key: "anthropic-test-key", type: "api_key" as const },
            openai: { key: "openai-test-key", type: "api_key" as const },
          }),
        ),
      );

      yield* awaited(
        expect(
          resolveCredentialForPrint(parseArgs(["--model", "gpt-5.5"]), runtime, "api_key"),
        ).resolves.toBe("openai-test-key"),
      );
    }),
  );

const printsBearerTokensResolvedFromAnAuthorization = () => {
  expect(
    getAuthCredential({ auth: { headers: { Authorization: "Bearer header-test-token" } } }),
  ).toBe("header-test-token");
};

const refreshesAnExpiredOauthTokenBeforePrinting = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const storage = AuthStorage.inMemory({
        "openai-codex": {
          access: "old-test-token",
          expires: 0,
          refresh: "test-refresh-token",
          type: "oauth" as const,
        },
      });
      const runtime = yield* awaited(createRuntime(storage));
      const refresh = vi.fn(() =>
        effectRunPromise(
          awaited({
            access: "fresh-test-token",
            expires: currentTimeMillis() + 60 * 60 * 1000,
            refresh: "test-refresh-token",
            type: "oauth" as const,
          }),
        ),
      );
      const oauth = runtime.getProvider("openai-codex")?.auth.oauth;
      if (!(oauth !== undefined)) throw new Error("OpenAI Codex OAuth provider is not registered");
      oauth.refresh = refresh;
      const args = parseArgs(["--provider", "openai-codex"]);

      yield* awaited(
        expect(resolveCredentialForPrint(args, runtime, "bearer_token")).resolves.toBe(
          "fresh-test-token",
        ),
      );
      expect(refresh).toHaveBeenCalledOnce();
      expect(yield* awaited(storage.read("openai-codex"))).toMatchObject({
        access: "fresh-test-token",
      });
    }),
  );

const reportsUnknownAuthOptionsLikePackageCommands = () =>
  runTest(
    Effect.gen(function* () {
      const originalExitCode = process.exitCode;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        process.exitCode = undefined;
        yield* awaited(main(["auth", "check", "--provider", "openai-codex", "--credentails"]));
        const stderr = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
        expect(stderr).toContain('Unknown option --credentails for "auth check".');
        expect(stderr).toContain(
          'Use "msa --help" or "msa auth check --provider <provider> [--json] [--credentials] [--no-refresh]".',
        );
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = originalExitCode;
        errorSpy.mockRestore();
      }
    }),
  );

const parsesCredentialCommandsAndRejectsInvalidArgumentsPart1 = () =>
  Effect.gen(function* () {
    const runtime = yield* awaited(
      createRuntime(
        AuthStorage.inMemory({
          "openai-codex": {
            access: "test-token-not-to-be-printed",
            expires: currentTimeMillis() + 60 * 60 * 1000,
            refresh: "test-refresh-token",
            type: "oauth" as const,
          },
        }),
      ),
    );
    return { runtime };
  });

const parsesCredentialCommandsAndRejectsInvalidArguments = () =>
  runTest(
    Effect.gen(function* () {
      const { runtime } = yield* parsesCredentialCommandsAndRejectsInvalidArgumentsPart1();

      expect(parseAuthCommand(["auth", "print-api-key", "--provider", "openai"])).toEqual({
        args: ["--provider", "openai"],
        credentials: false,
        json: false,
        kind: "api_key" as const,
        noRefresh: false,
      });
      expect(parseAuthCommand(["auth", "print-bearer-token"])).toMatchObject({
        kind: "bearer_token" as const,
      });
      expect(parseAuthCommand(["auth", "print-bearer-token", "--min-expiry", "30m"])).toEqual({
        args: [],
        credentials: false,
        json: false,
        kind: "bearer_token" as const,
        minExpiryMs: 30 * 60_000,
        noRefresh: false,
      });
      expect(() => parseAuthCommand(["auth", "print-api-key", "--min-expiry", "30m"])).toThrow(
        "only supported by print-bearer-token",
      );
      expect(isAuthCommandHelp(["auth", "--help"])).toBe(true);
      expect(isAuthCommandHelp(["auth", "print-api-key", "--help"])).toBe(true);
      expect(isAuthCommandHelp(["auth", "print-bearer-token", "-h"])).toBe(true);
      expect(isAuthCommandHelp(["auth", "check", "--help"])).toBe(true);
      expect(() => parseAuthCommand(["auth", "unknown"])).toThrow(AuthCommandError);
      yield* awaited(
        expect(resolveCredentialForPrint(parseArgs([]), runtime, "api_key")).rejects.toThrow(
          "requires --provider <provider> or --model <model>",
        ),
      );
      yield* awaited(
        expect(
          resolveCredentialForPrint(parseArgs(["--provider", "openai-codex"]), runtime, "api_key"),
        ).rejects.toThrow("configured with OAuth"),
      );
    }),
  );

describe("credential print commands", () => {
  test("prints a resolved API key", printsAResolvedApiKey);

  test(
    "resolves --model without --provider only among catalog models of configured providers",
    resolvesModelWithoutProviderOnlyAmongCatalog,
  );

  test(
    "prints bearer tokens resolved from an Authorization header",
    printsBearerTokensResolvedFromAnAuthorization,
  );

  test(
    "refreshes an expired OAuth token before printing it",
    refreshesAnExpiredOauthTokenBeforePrinting,
  );

  test(
    "reports unknown auth options like package commands",
    reportsUnknownAuthOptionsLikePackageCommands,
  );

  test(
    "parses credential commands and rejects invalid arguments or credential types",
    parsesCredentialCommandsAndRejectsInvalidArguments,
  );
});
