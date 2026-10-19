import * as fs from "node:fs";
import * as os from "node:os";

import {
  awaited,
  runTest,
  fromJsonText,
  readTextFile,
  writeTextFile,
  joinPath,
  removePath,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../src/config.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { readEnv, writeEnv, deleteEnv } from "../src/core/process-env.ts";
import { runMigrations } from "../src/migrations.ts";
import { createModelRegistry } from "./model-runtime-test-utils.ts";

describe("config value env var syntax migration", () => {
  const tempDirs: string[] = [];

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        for (const dir of tempDirs.splice(0)) {
          yield* removePath(dir);
        }
        vi.restoreAllMocks();
      }),
    ),
  );

  function createAgentDir(): string {
    const agentDir = fs.mkdtempSync(joinPath(os.tmpdir(), "msa-config-value-migration-test-"));
    tempDirs.push(agentDir);
    return agentDir;
  }

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

  it("leaves uppercase auth.json API key values unchanged", () => {
    const agentDir = createAgentDir();
    fs.writeFileSync(
      joinPath(agentDir, "auth.json"),
      `${JSON.stringify(
        {
          "anthropic-api": { type: "api_key" as const, key: "ANTHROPIC_API_KEY" },
          openai: { type: "api_key" as const, key: "$OPENAI_API_KEY" },
          opencode: { type: "api_key" as const, key: "public" },
          github: {
            type: "oauth" as const,
            access: "ACCESS_TOKEN",
            refresh: "REFRESH_TOKEN",
            expires: 1,
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    withAgentDir(agentDir, () => runMigrations(agentDir));

    const migrated = JSON.parse(
      fs.readFileSync(joinPath(agentDir, "auth.json"), "utf-8"),
    ) as Record<string, Record<string, unknown>>;
    expect(migrated["anthropic-api"]?.["key"]).toBe("ANTHROPIC_API_KEY");
    expect(migrated["openai"]?.["key"]).toBe("$OPENAI_API_KEY");
    expect(migrated["opencode"]?.["key"]).toBe("public");
    expect(migrated["github"]?.["access"]).toBe("ACCESS_TOKEN");
    expect(logSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed", '{\n  "providers": {\n'],
    ["blank", ""],
  ])("does not throw on %s models.json during migrations", (_name, content) =>
    runTest(
      Effect.gen(function* () {
        const agentDir = createAgentDir();
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
    runTest(
      Effect.gen(function* () {
        const agentDir = createAgentDir();
        const envKeys = ["CUSTOM_API_KEY", "HEADER_API_KEY", "MODEL_API_KEY", "OVERRIDE_API_KEY"];
        const savedEnv: Record<string, string | undefined> = {};
        for (const key of envKeys) {
          savedEnv[key] = readEnv(key);
          writeEnv(key, `env-${key}`);
        }

        try {
          yield* writeTextFile(
            joinPath(agentDir, "models.json"),
            `${JSON.stringify(
              {
                providers: {
                  "custom-provider": {
                    baseUrl: "https://example.com/v1",
                    apiKey: "CUSTOM_API_KEY",
                    api: "openai-completions" as const,
                    headers: {
                      "x-api-key": "HEADER_API_KEY",
                      "x-literal": "literal",
                    },
                    models: [
                      {
                        id: "model-a",
                        headers: { "x-model-key": "MODEL_API_KEY" },
                      },
                    ],
                    modelOverrides: {
                      "model-b": { headers: { "x-override-key": "OVERRIDE_API_KEY" } },
                    },
                  },
                },
              },
              null,
              2,
            )}\n`,
          );
          const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

          withAgentDir(agentDir, () => runMigrations(agentDir));

          const migrated = (yield* fromJsonText(
            yield* readTextFile(joinPath(agentDir, "models.json")),
          )) as {
            providers: Record<
              string,
              {
                apiKey?: string;
                headers?: Record<string, string>;
                models?: Array<{ headers?: Record<string, string> }>;
                modelOverrides?: Record<string, { headers?: Record<string, string> }>;
              }
            >;
          };
          const provider = migrated.providers["custom-provider"]!;
          expect(provider.apiKey).toBe("CUSTOM_API_KEY");
          expect(provider.headers?.["x-api-key"]).toBe("HEADER_API_KEY");
          expect(provider.headers?.["x-literal"]).toBe("literal");
          expect(provider.models?.[0]?.headers?.["x-model-key"]).toBe("MODEL_API_KEY");
          expect(provider.modelOverrides?.["model-b"]?.headers?.["x-override-key"]).toBe(
            "OVERRIDE_API_KEY",
          );
          expect(logSpy).not.toHaveBeenCalled();

          const registry = yield* awaited(
            createModelRegistry(
              AuthStorage.create(joinPath(agentDir, "auth.json")),
              joinPath(agentDir, "models.json"),
            ),
          );
          const model = registry.find("custom-provider", "model-a");
          expect(model).toBeDefined();
          expect(yield* awaited(registry.getApiKeyForProvider("custom-provider"))).toBe(
            "CUSTOM_API_KEY",
          );
          expect(yield* awaited(registry.getApiKeyAndHeaders(model!))).toMatchObject({
            ok: true,
            apiKey: "CUSTOM_API_KEY",
            headers: {
              "x-api-key": "HEADER_API_KEY",
              "x-literal": "literal",
              "x-model-key": "MODEL_API_KEY",
            },
          });
        } finally {
          for (const key of envKeys) {
            if (savedEnv[key] === undefined) {
              deleteEnv(key);
            } else {
              writeEnv(key, savedEnv[key]);
            }
          }
        }
      }),
    ));
});
