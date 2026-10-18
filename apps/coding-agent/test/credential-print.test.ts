import { InMemoryModelsStore } from "@msa/ai";
import { awaited, runTest, currentTimeMillis } from "@msa/testing";
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

function createRuntime(credentials: AuthStorage): Promise<ModelRuntime> {
  return runTest(
    awaited(
      ModelRuntime.create({
        credentials,
        modelsPath: null,
        modelsStore: new InMemoryModelsStore(),
        allowModelNetwork: false,
      }),
    ),
  );
}

describe("credential print commands", () => {
  test("prints a resolved API key", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          createRuntime(
            AuthStorage.inMemory({ openai: { type: "api_key" as const, key: "test-api-key" } }),
          ),
        );
        const args = parseArgs(["--provider", "openai"]);

        yield* awaited(
          expect(resolveCredentialForPrint(args, runtime, "api_key")).resolves.toBe("test-api-key"),
        );
      }),
    ));

  test("resolves --model without --provider only among catalog models of configured providers", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          createRuntime(
            AuthStorage.inMemory({
              openai: { type: "api_key" as const, key: "openai-test-key" },
              anthropic: { type: "api_key" as const, key: "anthropic-test-key" },
            }),
          ),
        );

        yield* awaited(
          expect(
            resolveCredentialForPrint(parseArgs(["--model", "gpt-5.5"]), runtime, "api_key"),
          ).resolves.toBe("openai-test-key"),
        );
      }),
    ));

  test("prints bearer tokens resolved from an Authorization header", () => {
    expect(
      getAuthCredential({ auth: { headers: { Authorization: "Bearer header-test-token" } } }),
    ).toBe("header-test-token");
  });

  test("refreshes an expired OAuth token before printing it", () =>
    runTest(
      Effect.gen(function* () {
        const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

        const storage = AuthStorage.inMemory({
          "openai-codex": {
            type: "oauth" as const,
            access: "old-test-token",
            refresh: "test-refresh-token",
            expires: 0,
          },
        });
        const runtime = yield* awaited(createRuntime(storage));
        const refresh = vi.fn(() =>
          effectRunPromise(
            awaited({
              type: "oauth" as const,
              access: "fresh-test-token",
              refresh: "test-refresh-token",
              expires: currentTimeMillis() + 60 * 60 * 1000,
            }),
          ),
        );
        const oauth = runtime.getProvider("openai-codex")?.auth.oauth;
        if (!oauth) throw new Error("OpenAI Codex OAuth provider is not registered");
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
    ));

  test("reports unknown auth options like package commands", () =>
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
    ));

  test("parses credential commands and rejects invalid arguments or credential types", () =>
    runTest(
      Effect.gen(function* () {
        const runtime = yield* awaited(
          createRuntime(
            AuthStorage.inMemory({
              "openai-codex": {
                type: "oauth" as const,
                access: "test-token-not-to-be-printed",
                refresh: "test-refresh-token",
                expires: currentTimeMillis() + 60 * 60 * 1000,
              },
            }),
          ),
        );

        expect(parseAuthCommand(["auth", "print-api-key", "--provider", "openai"])).toEqual({
          kind: "api_key" as const,
          args: ["--provider", "openai"],
          json: false,
          credentials: false,
          noRefresh: false,
        });
        expect(parseAuthCommand(["auth", "print-bearer-token"])).toMatchObject({
          kind: "bearer_token" as const,
        });
        expect(parseAuthCommand(["auth", "print-bearer-token", "--min-expiry", "30m"])).toEqual({
          kind: "bearer_token" as const,
          args: [],
          json: false,
          credentials: false,
          noRefresh: false,
          minExpiryMs: 30 * 60_000,
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
            resolveCredentialForPrint(
              parseArgs(["--provider", "openai-codex"]),
              runtime,
              "api_key",
            ),
          ).rejects.toThrow("configured with OAuth"),
        );
      }),
    ));
});
