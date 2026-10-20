import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import config from "../../../src/config.ts";
import AuthStorage from "../../../src/core/auth-storage.ts";
import migrations from "../../../src/migrations.ts";
import modelRuntimeTestUtils from "../../model-runtime-test-utils.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { ENV_AGENT_DIR } = config;
const { runMigrations } = migrations;
const { createHarness } = harnessModule;
const { createModelRegistry } = modelRuntimeTestUtils;

const { fromJsonText, joinPath, toJsonText } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const cleanups: Array<() => void> = [];

function withAgentDir(agentDir: string, fn: () => void): void {
  vi.stubEnv(ENV_AGENT_DIR, agentDir);
  try {
    fn();
  } finally {
    vi.unstubAllEnvs();
  }
}

const keepsUppercaseHeaderStringsAsLiterals = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  cleanups.push(harness.cleanup);
  const envKeys = ["CUSTOM_API_KEY", "BEARER"];
  for (const key of envKeys) vi.stubEnv(key, `env-${key}`);
  cleanups.push(() => {
    vi.unstubAllEnvs();
  });
  const modelsPath = joinPath(harness.tempDir, "models.json");
  yield* fs.writeFileString(
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
  withAgentDir(harness.tempDir, () => runMigrations(harness.tempDir));
  const migrated = (yield* fromJsonText(yield* fs.readFileString(modelsPath))) as {
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

const afterEachHook = () => {
  while (cleanups.length > 0) {
    cleanups.pop()?.();
  }
};

describe("regression #5661: uppercase models.json header values", () => {
  afterEach(afterEachHook);
  it(
    "keeps uppercase header strings as literals during startup migrations",
    keepsUppercaseHeaderStringsAsLiteralsDuring,
  );
});
