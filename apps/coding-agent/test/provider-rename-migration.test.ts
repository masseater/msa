import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import config from "../src/config.ts";
import migrations from "../src/migrations.ts";

const { runMigrations } = migrations;
const { ENV_AGENT_DIR } = config;

const { joinPath, makeTempDir, readJsonFile, removePath, runTest, writeJsonFile } = testing;

let agentDir: string;

const write = (name: string, value: unknown) => writeJsonFile(joinPath(agentDir, name), value);

const read = (name: string) => readJsonFile(joinPath(agentDir, name));

const movesAnthropicToAnthropicApiAndClaude = Effect.gen(function* () {
  yield* write("auth.json", {
    anthropic: { key: "sk-ant", type: "api_key" },
    openrouter: { key: "sk-or", type: "api_key" },
  });
  yield* write("models.json", {
    providers: {
      anthropic: { baseUrl: "https://proxy.example.com" },
      openrouter: { modelOverrides: { "anthropic/claude-opus-4.8": { name: "kept" } } },
    },
  });
  yield* write("settings.json", {
    defaultModel: "opus",
    defaultProvider: "claude-code",
    defaultThinkingLevels: { "anthropic/claude-opus-4-8": "high" },
    enabledModels: ["anthropic/claude-*", "claude-code-work/sonnet", "openrouter/anthropic/x"],
  });

  runMigrations(agentDir);

  expect(yield* read("auth.json")).toEqual({
    "anthropic-api": { key: "sk-ant", type: "api_key" },
    openrouter: { key: "sk-or", type: "api_key" },
  });
  expect(yield* read("models.json")).toEqual({
    providers: {
      "anthropic-api": { baseUrl: "https://proxy.example.com" },
      openrouter: { modelOverrides: { "anthropic/claude-opus-4.8": { name: "kept" } } },
    },
  });
  expect(yield* read("settings.json")).toEqual({
    defaultModel: "opus",
    defaultProvider: "claude-subs",
    defaultThinkingLevels: { "anthropic-api/claude-opus-4-8": "high" },
    enabledModels: ["anthropic-api/claude-*", "claude-subs-work/sonnet", "openrouter/anthropic/x"],
  });
});

const dropsAClaudeProMaxSignIn = Effect.gen(function* () {
  yield* write("auth.json", {
    anthropic: { access: "a", expires: 0, refresh: "r", type: "oauth" },
  });
  runMigrations(agentDir);
  expect(yield* read("auth.json")).toEqual({});
});

const keepsACredentialAlreadyStoredUnderThe = Effect.gen(function* () {
  yield* write("auth.json", {
    anthropic: { key: "old", type: "api_key" },
    "anthropic-api": { key: "new", type: "api_key" },
  });
  runMigrations(agentDir);
  expect(yield* read("auth.json")).toEqual({ "anthropic-api": { key: "new", type: "api_key" } });
});

describe("renamed provider migration", () => {
  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        agentDir = yield* makeTempDir("msa-provider-rename-");
        vi.stubEnv(ENV_AGENT_DIR, agentDir);
      }),
    ),
  );

  afterEach(() => runTest(removePath(agentDir)));

  it("moves anthropic to anthropic-api and claude-code to claude-subs", () =>
    runTest(movesAnthropicToAnthropicApiAndClaude));

  it("drops a Claude Pro/Max sign-in stored under anthropic", () =>
    runTest(dropsAClaudeProMaxSignIn));

  it("keeps a credential already stored under the new id", () =>
    runTest(keepsACredentialAlreadyStoredUnderThe));
});
