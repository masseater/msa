import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getModel } from "@msa/ai/compat";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const createSession = async (defaultTools?: string[]) => {
  const tempDir = mkdtempSync(join(tmpdir(), "msa-pr-watch-"));
  tempDirs.push(tempDir);
  const settingsManager = SettingsManager.inMemory(
    defaultTools === undefined ? {} : { defaultTools },
  );
  const resourceLoader = new DefaultResourceLoader({
    cwd: tempDir,
    agentDir: join(tempDir, "agent"),
    settingsManager,
  });
  await resourceLoader.reload();

  return (
    await createAgentSession({
      cwd: tempDir,
      agentDir: join(tempDir, "agent"),
      model: getModel("anthropic-api", "claude-sonnet-4-5")!,
      settingsManager,
      sessionManager: SessionManager.inMemory(tempDir),
      resourceLoader,
    })
  ).session;
};

describe("pr_watch in a session", () => {
  it("enables pr_watch by default and lists it in the system prompt", async () => {
    const session = await createSession();
    try {
      expect(session.getAllTools().map((tool) => tool.name)).toContain("pr_watch");
      expect(session.getActiveToolNames()).toContain("pr_watch");
      expect(session.systemPrompt).toContain("- pr_watch: Watch a GitHub pull request");
      expect(session.prWatch.entries).toEqual([]);
    } finally {
      session.dispose();
    }
  });

  it("keeps pr_watch out when a plain tool list replaces the defaults", async () => {
    const session = await createSession(["read", "grep"]);
    try {
      expect(session.getAllTools().map((tool) => tool.name)).toContain("pr_watch");
      expect(session.getActiveToolNames()).toEqual(["read", "grep"]);
      expect(session.systemPrompt).not.toContain("- pr_watch:");
    } finally {
      session.dispose();
    }
  });

  it("reads the check and status intervals from settings", async () => {
    const settingsManager = SettingsManager.inMemory({
      prWatch: { intervalSeconds: 90, statusIntervalSeconds: 600 },
    });

    expect(settingsManager.getPrWatchIntervalMs()).toBe(90_000);
    expect(settingsManager.getPrWatchStatusIntervalMs()).toBe(600_000);
    expect(SettingsManager.inMemory({}).getPrWatchIntervalMs()).toBe(45_000);
    expect(SettingsManager.inMemory({}).getPrWatchStatusIntervalMs()).toBe(300_000);
  });
});
