import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../../../src/config.ts";
import { AuthStorage } from "../../../src/core/auth-storage.ts";
import { runMigrations } from "../../../src/migrations.ts";
import { createModelRegistry } from "../../model-runtime-test-utils.ts";
import { parseJson, stringifyJsonPretty } from "../../test-json.ts";
import { join } from "../../test-path.ts";
import { createHarness } from "../harness.ts";
import type { Harness } from "../harness.ts";

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
  const modelsPath = join(harness.tempDir, "models.json");
  yield* fs.writeFileString(
    modelsPath,
    `${stringifyJsonPretty({
      providers: {
        "my-provider": {
          baseUrl: "https://example.com/v1",
          apiKey: "CUSTOM_API_KEY",
          api: "openai-completions",
          headers: { Authorization: "BEARER" },
          models: [{ id: "my-model" }],
        },
      },
    })}\n`,
  );
  withAgentDir(harness.tempDir, () => runMigrations(harness.tempDir));
  const migrated = parseJson(yield* fs.readFileString(modelsPath)) as {
    providers: Record<string, { apiKey?: string; headers?: Record<string, string> }>;
  };
  expect(migrated.providers["my-provider"]?.apiKey).toBe("CUSTOM_API_KEY");
  expect(migrated.providers["my-provider"]?.headers?.["Authorization"]).toBe("BEARER");
  return yield* keepsUppercaseHeaderStringsAsLiteralsPart2(harness, modelsPath);
});

const keepsUppercaseHeaderStringsAsLiteralsPart2 = (harness: Harness, modelsPath: string) =>
  Effect.gen(function* () {
    const registry = yield* Effect.promise(() =>
      createModelRegistry(AuthStorage.create(join(harness.tempDir, "auth.json")), modelsPath),
    );
    const model = registry.find("my-provider", "my-model");
    expect(model).toBeDefined();
    expect(yield* Effect.promise(() => registry.getApiKeyAndHeaders(model!))).toMatchObject({
      ok: true,
      apiKey: "CUSTOM_API_KEY",
      headers: { Authorization: "BEARER" },
    });
  });

describe("regression #5661: uppercase models.json header values", () => {
  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });
  it("keeps uppercase header strings as literals during startup migrations", () =>
    Effect.runPromise(keepsUppercaseHeaderStringsAsLiterals));
});
