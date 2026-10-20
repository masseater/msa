import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { parseArgs } from "../src/cli/args.ts";
import { checkProviderAuth, getProviderCredential } from "../src/cli/auth-check.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import authCheckSupport from "./auth-check-support.ts";

const { afterEachHook, beforeEachHook, createRuntime } = authCheckSupport;

const { awaited, currentTimeMillis, runTest } = testing;

const reportsAConfiguredProviderAsReady = () =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        createRuntime(
          AuthStorage.inMemory({ openai: { key: "test-key", type: "api_key" as const } }),
        ),
      );

      yield* awaited(
        expect(checkProviderAuth(parseArgs(["--provider", "openai"]), runtime)).resolves.toEqual({
          authType: "api_key",
          provider: "openai",
          status: "ready",
        }),
      );
    }),
  );

const resolvesTheProviderFromModel = () =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(
        createRuntime(
          AuthStorage.inMemory({ openai: { key: "test-key", type: "api_key" as const } }),
        ),
      );

      yield* awaited(
        expect(
          checkProviderAuth(parseArgs(["--model", "openai/gpt-5.5"]), runtime),
        ).resolves.toEqual({
          authType: "api_key",
          provider: "openai",
          status: "ready",
        }),
      );
      yield* awaited(
        expect(
          checkProviderAuth(parseArgs(["--provider", "openai", "--model", "gpt-5.5"]), runtime),
        ).resolves.toMatchObject({ provider: "openai", status: "ready" }),
      );
    }),
  );

const readsCredentialsWithoutRefreshingOauthWhenRequested = () =>
  runTest(
    Effect.gen(function* () {
      const apiCredentials = AuthStorage.inMemory({
        openai: { key: "test-key", type: "api_key" as const },
      });
      const apiRuntime = yield* awaited(createRuntime(apiCredentials));
      yield* awaited(
        expect(
          getProviderCredential("openai", apiRuntime, apiCredentials, { refresh: false }),
        ).resolves.toBe("test-key"),
      );

      const credentials = AuthStorage.inMemory({
        "openai-codex": {
          access: "old-token",
          expires: 0,
          refresh: "refresh-token",
          type: "oauth" as const,
        },
      });
      const oauthRuntime = yield* awaited(createRuntime(credentials));
      const oauth = oauthRuntime.getProvider("openai-codex")?.auth.oauth;
      if (!(oauth !== undefined)) throw new Error("OpenAI Codex OAuth provider is not registered");
      const refresh = vi.fn(oauth.refresh);
      oauth.refresh = refresh;

      yield* awaited(
        expect(
          getProviderCredential("openai-codex", oauthRuntime, credentials, { refresh: false }),
        ).resolves.toBe("old-token"),
      );
      expect(refresh).not.toHaveBeenCalled();
    }),
  );

const refreshesOauthByDefault = () =>
  runTest(
    Effect.gen(function* () {
      const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

      const credentials = AuthStorage.inMemory({
        "openai-codex": {
          access: "old-token",
          expires: 0,
          refresh: "refresh-token",
          type: "oauth" as const,
        },
      });
      const runtime = yield* awaited(createRuntime(credentials));
      const oauth = runtime.getProvider("openai-codex")?.auth.oauth;
      if (!(oauth !== undefined)) throw new Error("OpenAI Codex OAuth provider is not registered");
      const refresh = vi.fn(() =>
        effectRunPromise(
          awaited({
            access: "fresh-token",
            expires: currentTimeMillis() + 60 * 60 * 1000,
            refresh: "refresh-token",
            type: "oauth" as const,
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
  );

const reportsAnUnknownProviderAsNotReady = () =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(createRuntime(AuthStorage.inMemory()));

      yield* awaited(
        expect(
          checkProviderAuth(parseArgs(["--provider", "not-installed"]), runtime),
        ).resolves.toEqual({
          provider: "not-installed",
          reason: "provider_not_found",
          status: "not_ready",
        }),
      );
    }),
  );

describe("auth check command", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  test("reports a configured provider as ready", reportsAConfiguredProviderAsReady);

  test("resolves the provider from --model", resolvesTheProviderFromModel);

  test(
    "reads credentials without refreshing OAuth when requested",
    readsCredentialsWithoutRefreshingOauthWhenRequested,
  );

  test("refreshes OAuth by default", refreshesOauthByDefault);

  test("reports an unknown provider as not ready", reportsAnUnknownProviderAsNotReady);
});
