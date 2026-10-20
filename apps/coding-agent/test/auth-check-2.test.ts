import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import argsModule from "../src/cli/args.ts";
import authCheck from "../src/cli/auth-check.ts";
import authCommand from "../src/cli/auth-command.ts";
import AuthStorage from "../src/core/auth-storage.ts";
import ReadOnlyAuthStorage from "../src/core/read-only-auth-storage.ts";
import authCheckSupport from "./auth-check-support.ts";
const { checkProviderAuth, createAuthCheckModelRuntime } = authCheck;
const { parseArgs } = argsModule;
const { parseAuthCommand } = authCommand;

const { afterEachHook, beforeEachHook, createRuntime, tempDir } = authCheckSupport;

const { awaited, joinPath, pathExists, runTest, toJsonText, writeTextFile } = testing;

const doesNotTreatAnUnresolvedStoredEnvironment = () =>
  runTest(
    Effect.gen(function* () {
      const authPath = joinPath(tempDir, "auth.json");
      yield* writeTextFile(
        authPath,
        yield* toJsonText({
          openai: { key: "$MISSING_AUTH_CHECK_KEY", type: "api_key" as const },
        }),
      );
      const runtime = yield* awaited(createRuntime(new ReadOnlyAuthStorage(authPath)));

      yield* awaited(
        expect(checkProviderAuth(parseArgs(["--provider", "openai"]), runtime)).resolves.toEqual({
          provider: "openai",
          reason: "credentials_not_configured",
          status: "not_ready",
        }),
      );
    }),
  );

const reportsMalformedAuthStateAsInvalid = () =>
  runTest(
    Effect.gen(function* () {
      const authPath = joinPath(tempDir, "auth.json");
      yield* writeTextFile(authPath, "{invalid-json");
      const runtime = yield* awaited(createRuntime(new ReadOnlyAuthStorage(authPath)));

      yield* awaited(
        expect(checkProviderAuth(parseArgs(["--provider", "openai"]), runtime)).resolves.toEqual({
          provider: "openai",
          reason: "invalid_state",
          status: "invalid",
        }),
      );
    }),
  );

const doesNotCreateAnAuthFileOr = () =>
  runTest(
    Effect.gen(function* () {
      const authPath = joinPath(tempDir, "agent", "auth.json");
      const runtime = yield* awaited(createRuntime(new ReadOnlyAuthStorage(authPath)));

      yield* awaited(
        expect(
          checkProviderAuth(parseArgs(["--provider", "openai"]), runtime),
        ).resolves.toMatchObject({
          reason: "credentials_not_configured",
          status: "not_ready",
        }),
      );
      expect(yield* pathExists(authPath)).toBe(false);
      expect(yield* pathExists(joinPath(tempDir, "agent"))).toBe(false);
    }),
  );

const acceptsOptionalJsonOutputCredentialOutputAnd = () => {
  expect(parseAuthCommand(["auth", "check", "--provider", "openai"])).toEqual({
    args: ["--provider", "openai"],
    credentials: false,
    json: false,
    kind: "check" as const,
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
    args: ["--provider", "openai"],
    credentials: true,
    json: true,
    kind: "check" as const,
    noRefresh: true,
  });
};

const createsAnAuthCheckRuntimeWithoutCatalog = () =>
  runTest(
    Effect.gen(function* () {
      const runtime = yield* awaited(createAuthCheckModelRuntime(AuthStorage.inMemory()));
      expect(runtime.getProvider("openai")).toBeDefined();
    }),
  );

describe("auth check command", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  test(
    "does not treat an unresolved stored environment reference as configured",
    doesNotTreatAnUnresolvedStoredEnvironment,
  );

  test("reports malformed auth state as invalid", reportsMalformedAuthStateAsInvalid);

  test("does not create an auth file or its parent directory", doesNotCreateAnAuthFileOr);

  test(
    "accepts optional JSON output, credential output, and --no-refresh",
    acceptsOptionalJsonOutputCredentialOutputAnd,
  );
});

describe("auth check command", () => {
  beforeEach(beforeEachHook);

  afterEach(afterEachHook);

  test(
    "creates an auth-check runtime without catalog storage",
    createsAnAuthCheckRuntimeWithoutCatalog,
  );
});
