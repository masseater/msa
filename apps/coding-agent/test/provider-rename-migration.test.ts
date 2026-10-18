import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../src/config.ts";
import { runMigrations } from "../src/migrations.ts";

describe("renamed provider migration", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "msa-provider-rename-"));
    vi.stubEnv(ENV_AGENT_DIR, agentDir);
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  const write = (name: string, value: unknown) =>
    writeFileSync(join(agentDir, name), JSON.stringify(value));
  const read = (name: string) => JSON.parse(readFileSync(join(agentDir, name), "utf8"));

  it("moves anthropic to anthropic-api and claude-code to claude-subs", () => {
    write("auth.json", {
      anthropic: { type: "api_key", key: "sk-ant" },
      openrouter: { type: "api_key", key: "sk-or" },
    });
    write("models.json", {
      providers: {
        anthropic: { baseUrl: "https://proxy.example.com" },
        openrouter: { modelOverrides: { "anthropic/claude-opus-4.8": { name: "kept" } } },
      },
    });
    write("settings.json", {
      defaultProvider: "claude-code",
      defaultModel: "opus",
      enabledModels: ["anthropic/claude-*", "claude-code-work/sonnet", "openrouter/anthropic/x"],
      defaultThinkingLevels: { "anthropic/claude-opus-4-8": "high" },
    });

    runMigrations(agentDir);

    expect(read("auth.json")).toEqual({
      "anthropic-api": { type: "api_key", key: "sk-ant" },
      openrouter: { type: "api_key", key: "sk-or" },
    });
    expect(read("models.json")).toEqual({
      providers: {
        "anthropic-api": { baseUrl: "https://proxy.example.com" },
        openrouter: { modelOverrides: { "anthropic/claude-opus-4.8": { name: "kept" } } },
      },
    });
    expect(read("settings.json")).toEqual({
      defaultProvider: "claude-subs",
      defaultModel: "opus",
      enabledModels: [
        "anthropic-api/claude-*",
        "claude-subs-work/sonnet",
        "openrouter/anthropic/x",
      ],
      defaultThinkingLevels: { "anthropic-api/claude-opus-4-8": "high" },
    });
  });

  it("keeps a credential already stored under the new id", () => {
    write("auth.json", {
      anthropic: { type: "api_key", key: "old" },
      "anthropic-api": { type: "api_key", key: "new" },
    });
    runMigrations(agentDir);
    expect(read("auth.json")).toEqual({ "anthropic-api": { type: "api_key", key: "new" } });
  });
});
