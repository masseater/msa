import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { readEnv } from "../src/core/process-env.ts";
afterEach(() => vi.unstubAllEnvs());

import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { detectInstallChange } from "../src/config.ts";

const execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
const originalPath = readEnv("PATH");
const originalMsaPackageDir = readEnv("MSA_PACKAGE_DIR");
const originalArgv1 = process.argv[1];
let tempDir: string | undefined;
afterEach(() => {
  if (execPathDescriptor !== undefined) {
    Object.defineProperty(process, "execPath", execPathDescriptor);
  }
  if (originalPath === undefined) {
    vi.stubEnv("PATH", undefined);
  } else {
    vi.stubEnv("PATH", originalPath);
  }
  if (originalMsaPackageDir === undefined) {
    vi.stubEnv("MSA_PACKAGE_DIR", undefined);
  } else {
    vi.stubEnv("MSA_PACKAGE_DIR", originalMsaPackageDir);
  }
  if (originalArgv1 === undefined) {
    process.argv.splice(1, 1);
  } else {
    process.argv[1] = originalArgv1;
  }
  if (tempDir !== undefined && tempDir.length > 0) {
    chmodSync(tempDir, 0o700);
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});
describe("detectInstallChange", () => {
  test("reports a removed install instead of reading a package.json further up", () => {
    tempDir = mkdtempSync(join(tmpdir(), "msa-install-change-"));
    const installDir = join(tempDir, "global", "hash");
    mkdirSync(installDir, { recursive: true });
    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ version: "0.0.1" }));
    rmSync(installDir, { recursive: true, force: true });
    expect(detectInstallChange(join(installDir, "package.json"))).toEqual({ kind: "removed" });
  });
});
