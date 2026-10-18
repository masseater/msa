import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, join } from "path";

import { afterEach, describe, expect, test } from "vite-plus/test";

import {
  detectInstallMethod,
  getSelfUpdateCommand,
  getSelfUpdateUnavailableInstruction,
} from "../src/config.ts";

const execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
const originalPath = process.env["PATH"];
const originalMsaPackageDir = process.env["MSA_PACKAGE_DIR"];
const originalArgv1 = process.argv[1];
let tempDir: string | undefined;

function setExecPath(value: string): void {
  Object.defineProperty(process, "execPath", {
    value,
    configurable: true,
  });
}

afterEach(() => {
  if (execPathDescriptor !== undefined) {
    Object.defineProperty(process, "execPath", execPathDescriptor);
  }
  if (originalPath === undefined) {
    delete process.env["PATH"];
  } else {
    process.env["PATH"] = originalPath;
  }
  if (originalMsaPackageDir === undefined) {
    delete process.env["MSA_PACKAGE_DIR"];
  } else {
    process.env["MSA_PACKAGE_DIR"] = originalMsaPackageDir;
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

function createNpmPrefixInstall(template = "msa-prefix-"): { prefix: string; packageDir: string } {
  const prefix = mkdtempSync(join(tmpdir(), template));
  const root = join(prefix, "lib", "node_modules");
  const scopeDir = join(root, "@msa");
  const packageDir = join(scopeDir, "coding-agent");
  mkdirSync(packageDir, { recursive: true });
  tempDir = prefix;
  process.env["MSA_PACKAGE_DIR"] = packageDir;
  setExecPath(join(packageDir, "dist", "cli.js"));
  return { prefix, packageDir };
}

function createBunGlobalInstall(): { packageDir: string } {
  const temp = mkdtempSync(join(tmpdir(), "msa-bun-"));
  const prefix = join(temp, ".bun");
  const bunBin = join(prefix, "bin");
  const root = join(prefix, "install", "global", "node_modules");
  const scopeDir = join(root, "@msa");
  const packageDir = join(scopeDir, "coding-agent");
  mkdirSync(packageDir, { recursive: true });
  mkdirSync(bunBin, { recursive: true });
  writeFileSync(
    join(bunBin, process.platform === "win32" ? "bun.cmd" : "bun"),
    createFakeBunScript(bunBin),
  );
  chmodSync(join(bunBin, process.platform === "win32" ? "bun.cmd" : "bun"), 0o755);
  tempDir = temp;
  process.env["PATH"] = `${bunBin}${delimiter}${originalPath ?? ""}`;
  process.env["MSA_PACKAGE_DIR"] = packageDir;
  setExecPath(join(packageDir, "dist", "cli.js"));
  return { packageDir };
}

function createFakeBunScript(bunBin: string): string {
  if (process.platform === "win32") {
    return `@echo off\r\nif "%1"=="pm" if "%2"=="bin" if "%3"=="-g" echo ${bunBin}\r\n`;
  }
  const escapedBunBin = bunBin.replaceAll("'", "'\\''");
  return `#!/bin/sh\nif [ "$1" = "pm" ] && [ "$2" = "bin" ] && [ "$3" = "-g" ]; then\n\tprintf '%s\\n' '${escapedBunBin}'\n\texit 0\nfi\nexit 1\n`;
}

describe("detectInstallMethod 2", () => {
  test("self-updates renamed bun global installs by removing the old package first", () => {
    createBunGlobalInstall();

    const command = getSelfUpdateCommand(
      "@mariozechner/pi-coding-agent",
      undefined,
      "@new-scope/msa",
    );

    expect(detectInstallMethod()).toBe("bun");
    expect(command).toEqual({
      command: "bun",
      args: ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", "@new-scope/msa"],
      display:
        "bun uninstall -g @mariozechner/pi-coding-agent && bun install -g --ignore-scripts --minimum-release-age=0 @new-scope/msa",
      steps: [
        {
          command: "bun",
          args: ["uninstall", "-g", "@mariozechner/pi-coding-agent"],
          display: "bun uninstall -g @mariozechner/pi-coding-agent",
        },
        {
          command: "bun",
          args: ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", "@new-scope/msa"],
          display: "bun install -g --ignore-scripts --minimum-release-age=0 @new-scope/msa",
        },
      ],
    });
  });
  test("does not self-update when npm install path is not writable", () => {
    const { packageDir } = createNpmPrefixInstall();
    chmodSync(packageDir, 0o500);

    expect(getSelfUpdateCommand("@msa/coding-agent")).toBeUndefined();
    expect(getSelfUpdateUnavailableInstruction("@msa/coding-agent")).toContain(
      "the install path is not writable",
    );
  });
});
