import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../src/config.ts", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    PACKAGE_NAME: "@example/msa-coding-agent",
  };
});

import { shouldRunFirstTimeSetup } from "../src/cli/startup-ui.ts";

describe("shouldRunFirstTimeSetup in forked distributions", () => {
  const originalMsaExperimental = process.env.MSA_EXPERIMENTAL;
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "msa-first-time-setup-fork-"));
    settingsPath = join(tempDir, "settings.json");
    process.env.MSA_EXPERIMENTAL = "1";
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalMsaExperimental === undefined) {
      delete process.env.MSA_EXPERIMENTAL;
    } else {
      process.env.MSA_EXPERIMENTAL = originalMsaExperimental;
    }
  });

  it("returns false for a forked package", () => {
    expect(shouldRunFirstTimeSetup(settingsPath)).toBe(false);
  });
});
