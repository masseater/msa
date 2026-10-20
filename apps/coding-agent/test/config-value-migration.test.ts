import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../src/config.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { deleteEnv, readEnv, writeEnv } from "../src/core/process-env.ts";
import { runMigrations } from "../src/migrations.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { createModelRegistry } = modelRuntimeTestUtils;

const {
  awaited,
  fromJsonText,
  joinPath,
  makeTempDir,
  readTextFile,
  removeDirs,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

const tempDirs: string[] = [];

const createAgentDir = Effect.fn("createAgentDir")(function* () {
  const agentDir = yield* makeTempDir("msa-config-value-migration-test-");
  tempDirs.push(agentDir);
  return agentDir;
});

function withAgentDir(agentDir: string, fn: () => void): void {
  const previousAgentDir = readEnv(ENV_AGENT_DIR);
  writeEnv(ENV_AGENT_DIR, agentDir);
  try {
    fn();
  } finally {
    if (previousAgentDir === undefined) {
      deleteEnv(ENV_AGENT_DIR);
    } else {
      writeEnv(ENV_AGENT_DIR, previousAgentDir);
    }
  }
}

const AUTH_FIXTURE = {
  "anthropic-api": { key: "ANTHROPIC_API_KEY", type: "api_key" },
  github: { access: "ACCESS_TOKEN", expires: 1, refresh: "REFRESH_TOKEN", type: "oauth" },
  openai: { key: "$OPENAI_API_KEY", type: "api_key" },
  opencode: { key: "public", type: "api_key" },
};

const MODELS_FIXTURE = {
  providers: {
    "custom-provider": {
      api: "openai-completions",
      apiKey: "CUSTOM_API_KEY",
      baseUrl: "https://example.com/v1",
      headers: { "x-api-key": "HEADER_API_KEY", "x-literal": "literal" },
      modelOverrides: { "model-b": { headers: { "x-override-key": "OVERRIDE_API_KEY" } } },
      models: [{ headers: { "x-model-key": "MODEL_API_KEY" }, id: "model-a" }],
    },
  },
};

interface MigratedProvider {
  apiKey?: string;
  headers?: Record<string, string>;
  models?: Array<{ headers?: Record<string, string> }>;
  modelOverrides?: Record<string, { headers?: Record<string, string> }>;
}

const ENV_KEYS = ["CUSTOM_API_KEY", "HEADER_API_KEY", "MODEL_API_KEY", "OVERRIDE_API_KEY"];

const withEnvKeys = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const saved = new Map(ENV_KEYS.map((key) => [key, readEnv(key)]));
      for (const key of ENV_KEYS) writeEnv(key, `env-${key}`);
      return saved;
    }),
    () => effect,
    (saved) =>
      Effect.sync(() => {
        for (const [key, value] of saved) {
          if (value === undefined) deleteEnv(key);
          else writeEnv(key, value);
        }
      }),
  );

const readMigrated = Effect.fn("readMigrated")(function* (path: string) {
  return (yield* fromJsonText(yield* readTextFile(path))) as Record<string, unknown>;
});

const leavesUppercaseAuthJsonApiKeyValues = Effect.gen(function* () {
  const agentDir = yield* createAgentDir();
  yield* writeTextFile(joinPath(agentDir, "auth.json"), `${yield* toJsonText(AUTH_FIXTURE)}\n`);
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  withAgentDir(agentDir, () => runMigrations(agentDir));
  const migrated = (yield* readMigrated(joinPath(agentDir, "auth.json"))) as Record<
    string,
    Record<string, unknown>
  >;
  expect(migrated["anthropic-api"]?.["key"]).toBe("ANTHROPIC_API_KEY");
  expect(migrated["openai"]?.["key"]).toBe("$OPENAI_API_KEY");
  expect(migrated["opencode"]?.["key"]).toBe("public");
  expect(migrated["github"]?.["access"]).toBe("ACCESS_TOKEN");
  expect(logSpy).not.toHaveBeenCalled();
});

const expectProviderUnchanged = (provider: MigratedProvider | undefined) => {
  expect(provider?.apiKey).toBe("CUSTOM_API_KEY");
  expect(provider?.headers?.["x-api-key"]).toBe("HEADER_API_KEY");
  expect(provider?.headers?.["x-literal"]).toBe("literal");
  expect(provider?.models?.[0]?.headers?.["x-model-key"]).toBe("MODEL_API_KEY");
  expect(provider?.modelOverrides?.["model-b"]?.headers?.["x-override-key"]).toBe(
    "OVERRIDE_API_KEY",
  );
};

const expectRegistryResolvesLiterals = Effect.fn("expectRegistryResolvesLiterals")(function* (
  agentDir: string,
) {
  const registry = yield* awaited(
    createModelRegistry(
      AuthStorage.create(joinPath(agentDir, "auth.json")),
      joinPath(agentDir, "models.json"),
    ),
  );
  const model = registry.find("custom-provider", "model-a");
  expect(model).toBeDefined();
  expect(yield* awaited(registry.getApiKeyForProvider("custom-provider"))).toBe("CUSTOM_API_KEY");
  if (model === undefined) return;
  expect(yield* awaited(registry.getApiKeyAndHeaders(model))).toMatchObject({
    apiKey: "CUSTOM_API_KEY",
    headers: {
      "x-api-key": "HEADER_API_KEY",
      "x-literal": "literal",
      "x-model-key": "MODEL_API_KEY",
    },
    ok: true,
  });
});

const leavesUppercaseModelsJsonApiKeyAnd = withEnvKeys(
  Effect.gen(function* () {
    const agentDir = yield* createAgentDir();
    const modelsPath = joinPath(agentDir, "models.json");
    yield* writeTextFile(modelsPath, `${yield* toJsonText(MODELS_FIXTURE)}\n`);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    withAgentDir(agentDir, () => runMigrations(agentDir));
    const migrated = (yield* readMigrated(modelsPath)) as {
      providers: Record<string, MigratedProvider>;
    };
    expectProviderUnchanged(migrated.providers["custom-provider"]);
    expect(logSpy).not.toHaveBeenCalled();
    yield* expectRegistryResolvesLiterals(agentDir);
  }),
);

const afterEachHook = Effect.suspend(() => {
  vi.restoreAllMocks();
  return removeDirs(tempDirs.splice(0));
});

describe("config value env var syntax migration", () => {
  afterEach(() => runTest(afterEachHook));

  it("leaves uppercase auth.json API key values unchanged", () =>
    runTest(leavesUppercaseAuthJsonApiKeyValues));

  it.each([
    ["malformed", '{\n  "providers": {\n'],
    ["blank", ""],
  ])("does not throw on %s models.json during migrations", (_name, content) =>
    runTest(
      Effect.gen(function* () {
        const agentDir = yield* createAgentDir();
        const modelsPath = joinPath(agentDir, "models.json");
        yield* writeTextFile(modelsPath, content);

        withAgentDir(agentDir, () => expect(() => runMigrations(agentDir)).not.toThrow());

        expect(yield* readTextFile(modelsPath)).toBe(content);
        const registry = yield* awaited(
          createModelRegistry(AuthStorage.create(joinPath(agentDir, "auth.json")), modelsPath),
        );
        const loadError = registry.getError();
        expect(loadError).toContain("Failed to parse models.json");
        expect(loadError).toContain(`File: ${modelsPath}`);
      }),
    ),
  );

  it("leaves uppercase models.json API key and header values unchanged", () =>
    runTest(leavesUppercaseModelsJsonApiKeyAnd));
});
