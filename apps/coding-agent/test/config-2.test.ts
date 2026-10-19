import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, join } from "path";

import { readEnv } from "../src/core/process-env.ts";
afterEach(() => vi.unstubAllEnvs());

import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { detectInstallMethod, getSelfUpdateCommand, getUpdateInstruction } from "../src/config.ts";

const execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
const originalPath = readEnv("PATH");
const originalMsaPackageDir = readEnv("MSA_PACKAGE_DIR");
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

function createNpmPrefixInstall(template = "msa-prefix-"): { prefix: string; packageDir: string } {
  const prefix = mkdtempSync(join(tmpdir(), template));
  const root = join(prefix, "lib", "node_modules");
  const scopeDir = join(root, "@msa");
  const packageDir = join(scopeDir, "coding-agent");
  mkdirSync(packageDir, { recursive: true });
  tempDir = prefix;
  vi.stubEnv("MSA_PACKAGE_DIR", packageDir);
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
  vi.stubEnv("PATH", `${bunBin}${delimiter}${originalPath ?? ""}`);
  vi.stubEnv("MSA_PACKAGE_DIR", packageDir);
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

describe("detectInstallMethod", () => {
  test("detects pnpm from Windows .pnpm install paths", () => {
    setExecPath(
      "C:\\Users\\Admin\\Documents\\pnpm-repository\\global\\5\\.pnpm\\@msa+coding-agent@0.67.68\\node_modules\\@msa\\coding-agent\\dist\\cli.js",
    );

    expect(detectInstallMethod()).toBe("pnpm");
    expect(getUpdateInstruction("@msa/coding-agent")).toBe(
      "Run: pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @msa/coding-agent",
    );
  });
  test("does not self-update unknown wrapper installs", () => {
    setExecPath("/usr/local/bin/node");

    expect(detectInstallMethod()).toBe("unknown");
    expect(getSelfUpdateCommand("@msa/coding-agent")).toBeUndefined();
    expect(getUpdateInstruction("@msa/coding-agent")).toBe(
      "Update @msa/coding-agent using the package manager, wrapper, or source checkout that provides this installation.",
    );
  });
  test("self-updates npm installs from custom prefixes", () => {
    const { prefix } = createNpmPrefixInstall();

    const command = getSelfUpdateCommand("@msa/coding-agent");

    expect(detectInstallMethod()).toBe("npm");
    expect(command).toEqual({
      command: "npm",
      args: [
        "--prefix",
        prefix,
        "install",
        "-g",
        "--ignore-scripts",
        "--min-release-age=0",
        "@msa/coding-agent",
      ],
      display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @msa/coding-agent`,
    });
  });
  test("self-updates exact npm versions without uninstalling the current package", () => {
    const { prefix } = createNpmPrefixInstall();

    const command = getSelfUpdateCommand("@msa/coding-agent", undefined, {
      packageName: "@msa/coding-agent",
      installSpec: "@msa/coding-agent@1.2.3",
    });

    expect(command).toEqual({
      command: "npm",
      args: [
        "--prefix",
        prefix,
        "install",
        "-g",
        "--ignore-scripts",
        "--min-release-age=0",
        "@msa/coding-agent@1.2.3",
      ],
      display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @msa/coding-agent@1.2.3`,
    });
  });
  test("self-updates renamed packages from the current install prefix", () => {
    const { prefix } = createNpmPrefixInstall();

    const command = getSelfUpdateCommand(
      "@mariozechner/pi-coding-agent",
      undefined,
      "@new-scope/msa",
    );

    expect(command).toEqual({
      command: "npm",
      args: [
        "--prefix",
        prefix,
        "install",
        "-g",
        "--ignore-scripts",
        "--min-release-age=0",
        "@new-scope/msa",
      ],
      display: `npm --prefix ${prefix} uninstall -g @mariozechner/pi-coding-agent && npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @new-scope/msa`,
      steps: [
        {
          command: "npm",
          args: ["--prefix", prefix, "uninstall", "-g", "@mariozechner/pi-coding-agent"],
          display: `npm --prefix ${prefix} uninstall -g @mariozechner/pi-coding-agent`,
        },
        {
          command: "npm",
          args: [
            "--prefix",
            prefix,
            "install",
            "-g",
            "--ignore-scripts",
            "--min-release-age=0",
            "@new-scope/msa",
          ],
          display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @new-scope/msa`,
        },
      ],
    });
  });
  test("self-update respects configured npmCommand", () => {
    const { prefix } = createNpmPrefixInstall();

    const command = getSelfUpdateCommand("@msa/coding-agent", ["npm", "--prefix", prefix]);

    expect(command).toEqual({
      command: "npm",
      args: [
        "--prefix",
        prefix,
        "install",
        "-g",
        "--ignore-scripts",
        "--min-release-age=0",
        "@msa/coding-agent",
      ],
      display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @msa/coding-agent`,
    });
  });
  test("self-update treats empty npmCommand as unset", () => {
    const { prefix } = createNpmPrefixInstall();

    const command = getSelfUpdateCommand("@msa/coding-agent", []);

    expect(command?.args).toEqual([
      "--prefix",
      prefix,
      "install",
      "-g",
      "--ignore-scripts",
      "--min-release-age=0",
      "@msa/coding-agent",
    ]);
  });
  test("quotes npm self-update display paths", () => {
    const { prefix } = createNpmPrefixInstall("msa prefix ");

    const command = getSelfUpdateCommand("@msa/coding-agent");

    expect(command?.display).toBe(
      `npm --prefix "${prefix}" install -g --ignore-scripts --min-release-age=0 @msa/coding-agent`,
    );
  });
  test("does not infer Windows npm custom prefixes from package paths", () => {
    const packageDir = "C:\\Users\\Admin\\npm prefix\\node_modules\\@msa\\coding-agent";
    vi.stubEnv("MSA_PACKAGE_DIR", packageDir);
    setExecPath(`${packageDir}\\dist\\cli.js`);

    expect(detectInstallMethod()).toBe("npm");
    expect(getUpdateInstruction("@msa/coding-agent")).toBe(
      "Run: npm install -g --ignore-scripts --min-release-age=0 @msa/coding-agent",
    );
  });
  test("self-updates bun global installs from bun pm bin", () => {
    createBunGlobalInstall();

    const command = getSelfUpdateCommand("@msa/coding-agent");

    expect(detectInstallMethod()).toBe("bun");
    expect(command).toEqual({
      command: "bun",
      args: ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", "@msa/coding-agent"],
      display: "bun install -g --ignore-scripts --minimum-release-age=0 @msa/coding-agent",
    });
  });
});
