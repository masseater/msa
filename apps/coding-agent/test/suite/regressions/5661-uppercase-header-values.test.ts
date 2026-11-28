import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import config from "../../../src/config.ts";
import AuthStorage from "../../../src/core/auth-storage.ts";
import migrations from "../../../src/migrations.ts";
import modelRuntimeTestUtils from "../../model-runtime-test-utils.ts";
import tempDirKit from "../../temp-dir.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { ENV_AGENT_DIR } = config;
const { runMigrations } = migrations;
const { createHarness } = harnessModule;
const { createModelRegistry } = modelRuntimeTestUtils;

const { awaited, fromJsonText, joinPath, readTextFile, toJsonText, writeTextFile } = testing;
const { useCleanups } = tempDirKit;

const cleanups = useCleanups();

function withAgentDir<T>(agentDir: string, fn: () => T): T {
  vi.stubEnv(ENV_AGENT_DIR, agentDir);
  try {
    return fn();
  } finally {
    vi.unstubAllEnvs();
  }
}

const keepsUppercaseHeaderStringsAsLiterals = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  cleanups.push(harness);
  const envKeys = ["CUSTOM_API_KEY", "BEARER"];
  for (const key of envKeys) vi.stubEnv(key, `env-${key}`);
  cleanups.push({
    cleanup: () => {
      vi.unstubAllEnvs();
    },
  });
  const modelsPath = joinPath(harness.tempDir, "models.json");
  yield* writeTextFile(
    modelsPath,
    `${yield* toJsonText({
      providers: {
        "my-provider": {
          api: "openai-completions",
          apiKey: "CUSTOM_API_KEY",
          baseUrl: "https://example.com/v1",
          headers: { Authorization: "BEARER" },
          models: [{ id: "my-model" }],
        },
      },
    })}\n`,
  );
  yield* awaited(withAgentDir(harness.tempDir, () => runMigrations(harness.tempDir)));
  const migrated = (yield* fromJsonText(yield* readTextFile(modelsPath))) as {
    providers: Record<string, { apiKey?: string; headers?: Record<string, string> }>;
  };
  expect(migrated.providers["my-provider"]?.apiKey).toBe("CUSTOM_API_KEY");
  expect(migrated.providers["my-provider"]?.headers?.["Authorization"]).toBe("BEARER");
  return yield* keepsUppercaseHeaderStringsAsLiteralsStep1(harness, modelsPath);
});

const keepsUppercaseHeaderStringsAsLiteralsStep1 = (
  harness: harnessTypes.Harness,
  modelsPath: string,
) =>
  Effect.gen(function* () {
    const registry = yield* Effect.promise(() =>
      createModelRegistry(AuthStorage.create(joinPath(harness.tempDir, "auth.json")), modelsPath),
    );
    const model = registry.find("my-provider", "my-model");
    expect(model).toBeDefined();
    expect(yield* Effect.promise(() => registry.getApiKeyAndHeaders(model!))).toMatchObject({
      apiKey: "CUSTOM_API_KEY",
      headers: { Authorization: "BEARER" },
      ok: true,
    });
  });

const keepsUppercaseHeaderStringsAsLiteralsDuring = () =>
  Effect.runPromise(keepsUppercaseHeaderStringsAsLiterals);

describe("regression #5661: uppercase models.json header values", () => {
  it(
    "keeps uppercase header strings as literals during startup migrations",
    keepsUppercaseHeaderStringsAsLiteralsDuring,
  );
});
