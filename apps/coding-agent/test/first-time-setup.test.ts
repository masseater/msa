import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";

import { joinPath, runTest, removePath } from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { shouldRunFirstTimeSetup } from "../src/cli/startup-ui.ts";
import { ENV_AGENT_DIR } from "../src/config.ts";
import { readEnv } from "../src/core/process-env.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

describe("shouldRunFirstTimeSetup", () => {
  const originalMsaExperimental = readEnv("MSA_EXPERIMENTAL");
  const originalAgentDir = process.env[ENV_AGENT_DIR];
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() =>
    runTest(
      Effect.gen(function* () {
        tempDir = mkdtempSync(joinPath(tmpdir(), "msa-first-time-setup-"));
        settingsPath = joinPath(tempDir, "settings.json");
        process.env["MSA_EXPERIMENTAL"] = "1";
        delete process.env[ENV_AGENT_DIR];
      }),
    ),
  );

  afterEach(() =>
    runTest(
      Effect.gen(function* () {
        yield* removePath(tempDir);
        if (originalMsaExperimental === undefined) {
          delete process.env["MSA_EXPERIMENTAL"];
        } else {
          process.env["MSA_EXPERIMENTAL"] = originalMsaExperimental;
        }
        if (originalAgentDir === undefined) {
          delete process.env[ENV_AGENT_DIR];
        } else {
          process.env[ENV_AGENT_DIR] = originalAgentDir;
        }
      }),
    ),
  );

  it("returns true when experimental, default agent dir, and no settings.json", () => {
    expect(shouldRunFirstTimeSetup(settingsPath)).toBe(true);
  });

  it("returns false when experimental features are disabled", () => {
    delete process.env["MSA_EXPERIMENTAL"];

    expect(shouldRunFirstTimeSetup(settingsPath)).toBe(false);
  });

  it("returns false when a custom agent dir is set", () => {
    process.env[ENV_AGENT_DIR] = tempDir;

    expect(shouldRunFirstTimeSetup(settingsPath)).toBe(false);
  });

  it("returns false when settings.json already exists", () => {
    writeFileSync(settingsPath, "{}", "utf-8");

    expect(shouldRunFirstTimeSetup(settingsPath)).toBe(false);
  });
});

describe("analytics settings", () => {
  it("defaults to disabled with no tracking identifier", () => {
    const manager = SettingsManager.inMemory();

    expect(manager.getEnableAnalytics()).toBe(false);
    expect(manager.getTrackingId()).toBeUndefined();
  });

  it("generates a tracking identifier on opt-in", () => {
    const manager = SettingsManager.inMemory();

    manager.setEnableAnalytics(true);

    expect(manager.getEnableAnalytics()).toBe(true);
    expect(manager.getTrackingId()).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("does not generate a tracking identifier on opt-out", () => {
    const manager = SettingsManager.inMemory();

    manager.setEnableAnalytics(false);

    expect(manager.getEnableAnalytics()).toBe(false);
    expect(manager.getTrackingId()).toBeUndefined();
  });

  it("keeps the tracking identifier when toggling analytics", () => {
    const manager = SettingsManager.inMemory();

    manager.setEnableAnalytics(true);
    const trackingId = manager.getTrackingId();
    manager.setEnableAnalytics(false);
    manager.setEnableAnalytics(true);

    expect(manager.getTrackingId()).toBe(trackingId);
  });
});
