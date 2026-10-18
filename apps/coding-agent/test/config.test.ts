import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";

import { joinPath, pathDelimiter } from "@msa/testing";
import { afterEach, describe, expect, test } from "vite-plus/test";

import {
  detectInstallChange,
  detectInstallMethod,
  findNodePackageDir,
  getSelfUpdateCommand,
  getSelfUpdateUnavailableInstruction,
  getUpdateInstruction,
} from "../src/config.ts";
import { deleteEnv, readEnv, writeEnv } from "../src/core/process-env.ts";

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
  if (execPathDescriptor) {
    Object.defineProperty(process, "execPath", execPathDescriptor);
  }
  if (originalPath === undefined) {
    deleteEnv("PATH");
  } else {
    writeEnv("PATH", originalPath);
  }
  if (originalMsaPackageDir === undefined) {
    deleteEnv("MSA_PACKAGE_DIR");
  } else {
    writeEnv("MSA_PACKAGE_DIR", originalMsaPackageDir);
  }
  if (originalArgv1 === undefined) {
    process.argv.splice(1, 1);
  } else {
    process.argv[1] = originalArgv1;
  }
  if (tempDir) {
    chmodSync(tempDir, 0o700);
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function createNpmPrefixInstall(template = "msa-prefix-"): { prefix: string; packageDir: string } {
  const prefix = mkdtempSync(joinPath(tmpdir(), template));
  const root = joinPath(prefix, "lib", "node_modules");
  const scopeDir = joinPath(root, "@msa");
  const packageDir = joinPath(scopeDir, "coding-agent");
  mkdirSync(packageDir, { recursive: true });
  tempDir = prefix;
  writeEnv("MSA_PACKAGE_DIR", packageDir);
  setExecPath(joinPath(packageDir, "dist", "cli.js"));
  return { prefix, packageDir };
}

function createPnpmGlobalInstall(): { root: string; packageDir: string } {
  const temp = mkdtempSync(joinPath(tmpdir(), "msa-pnpm-"));
  const binDir = joinPath(temp, "bin");
  const root = joinPath(temp, "pnpm", "global", "5", "node_modules");
  const packageDir = joinPath(root, "@mariozechner", "msa-coding-agent");
  mkdirSync(packageDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    joinPath(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm"),
    createFakePnpmScript(root),
  );
  chmodSync(joinPath(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm"), 0o755);
  tempDir = temp;
  writeEnv("PATH", `${binDir}${pathDelimiter}${originalPath ?? ""}`);
  writeEnv("MSA_PACKAGE_DIR", packageDir);
  setExecPath(
    joinPath(
      root,
      ".pnpm",
      "@mariozechner+msa-coding-agent@0.0.0",
      "node_modules",
      "@mariozechner",
      "msa-coding-agent",
      "dist",
      "cli.js",
    ),
  );
  return { root, packageDir };
}

function createYarnGlobalInstall(): { globalDir: string; packageDir: string } {
  const temp = mkdtempSync(joinPath(tmpdir(), "msa-yarn-"));
  const binDir = joinPath(temp, "bin");
  const globalDir = joinPath(temp, "yarn", "global");
  const packageDir = joinPath(globalDir, "node_modules", "@mariozechner", "msa-coding-agent");
  mkdirSync(packageDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    joinPath(binDir, process.platform === "win32" ? "yarn.cmd" : "yarn"),
    createFakeYarnScript(globalDir),
  );
  chmodSync(joinPath(binDir, process.platform === "win32" ? "yarn.cmd" : "yarn"), 0o755);
  tempDir = temp;
  writeEnv("PATH", `${binDir}${pathDelimiter}${originalPath ?? ""}`);
  writeEnv("MSA_PACKAGE_DIR", packageDir);
  setExecPath(joinPath(globalDir, ".yarn", "@mariozechner", "msa-coding-agent", "dist", "cli.js"));
  return { globalDir, packageDir };
}

function createBunGlobalInstall(): { packageDir: string } {
  const temp = mkdtempSync(joinPath(tmpdir(), "msa-bun-"));
  const prefix = joinPath(temp, ".bun");
  const bunBin = joinPath(prefix, "bin");
  const root = joinPath(prefix, "install", "global", "node_modules");
  const scopeDir = joinPath(root, "@msa");
  const packageDir = joinPath(scopeDir, "coding-agent");
  mkdirSync(packageDir, { recursive: true });
  mkdirSync(bunBin, { recursive: true });
  writeFileSync(
    joinPath(bunBin, process.platform === "win32" ? "bun.cmd" : "bun"),
    createFakeBunScript(bunBin),
  );
  chmodSync(joinPath(bunBin, process.platform === "win32" ? "bun.cmd" : "bun"), 0o755);
  tempDir = temp;
  writeEnv("PATH", `${bunBin}${pathDelimiter}${originalPath ?? ""}`);
  writeEnv("MSA_PACKAGE_DIR", packageDir);
  setExecPath(joinPath(packageDir, "dist", "cli.js"));
  return { packageDir };
}

function createFakePnpmScript(root: string): string {
  if (process.platform === "win32") {
    return `@echo off\r\nif "%1"=="root" if "%2"=="-g" echo ${root}\r\n`;
  }
  const escapedRoot = root.replaceAll("'", "'\\''");
  return `#!/bin/sh\nif [ "$1" = "root" ] && [ "$2" = "-g" ]; then\n\tprintf '%s\\n' '${escapedRoot}'\n\texit 0\nfi\nexit 1\n`;
}

function createFakeYarnScript(globalDir: string): string {
  if (process.platform === "win32") {
    return `@echo off\r\nif "%1"=="global" if "%2"=="dir" echo ${globalDir}\r\n`;
  }
  const escapedGlobalDir = globalDir.replaceAll("'", "'\\''");
  return `#!/bin/sh\nif [ "$1" = "global" ] && [ "$2" = "dir" ]; then\n\tprintf '%s\\n' '${escapedGlobalDir}'\n\texit 0\nfi\nexit 1\n`;
}

function createFakeBunScript(bunBin: string): string {
  if (process.platform === "win32") {
    return `@echo off\r\nif "%1"=="pm" if "%2"=="bin" if "%3"=="-g" echo ${bunBin}\r\n`;
  }
  const escapedBunBin = bunBin.replaceAll("'", "'\\''");
  return `#!/bin/sh\nif [ "$1" = "pm" ] && [ "$2" = "bin" ] && [ "$3" = "-g" ]; then\n\tprintf '%s\\n' '${escapedBunBin}'\n\texit 0\nfi\nexit 1\n`;
}

describe("findNodePackageDir", () => {
  test("skips binary metadata copied into dist", () => {
    tempDir = mkdtempSync(joinPath(tmpdir(), "msa-package-dir-"));
    const distDir = joinPath(tempDir, "dist");
    const bundleDir = joinPath(distDir, "bundle");
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(joinPath(tempDir, "package.json"), "{}");
    writeFileSync(joinPath(distDir, "package.json"), "{}");

    expect(findNodePackageDir(bundleDir)).toBe(tempDir);
  });
});

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
    writeEnv("MSA_PACKAGE_DIR", packageDir);
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

  test("self-updates renamed pnpm global installs by removing the old package first", () => {
    createPnpmGlobalInstall();

    const command = getSelfUpdateCommand(
      "@mariozechner/pi-coding-agent",
      undefined,
      "@new-scope/msa",
    );

    expect(detectInstallMethod()).toBe("pnpm");
    expect(command).toEqual({
      command: "pnpm",
      args: ["install", "-g", "--ignore-scripts", "--config.minimumReleaseAge=0", "@new-scope/msa"],
      display:
        "pnpm remove -g @mariozechner/pi-coding-agent && pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @new-scope/msa",
      steps: [
        {
          command: "pnpm",
          args: ["remove", "-g", "@mariozechner/pi-coding-agent"],
          display: "pnpm remove -g @mariozechner/pi-coding-agent",
        },
        {
          command: "pnpm",
          args: [
            "install",
            "-g",
            "--ignore-scripts",
            "--config.minimumReleaseAge=0",
            "@new-scope/msa",
          ],
          display: "pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @new-scope/msa",
        },
      ],
    });
  });

  test("self-updates pnpm v11 global installs resolved through the store", () => {
    const temp = mkdtempSync(joinPath(tmpdir(), "msa-pnpm11-"));
    const binDir = joinPath(temp, "bin");
    const root = joinPath(temp, "Library", "pnpm", "global", "v11");
    const packageName = "@msa/coding-agent";
    const globalPackageDir = joinPath(root, "11e9a", "node_modules", "@msa", "coding-agent");
    const storePackageDir = joinPath(
      temp,
      "Library",
      "pnpm",
      "store",
      "v11",
      "links",
      "@msa",
      "coding-agent",
      "0.75.0",
      "hash",
      "node_modules",
      "@msa",
      "coding-agent",
    );
    mkdirSync(globalPackageDir, { recursive: true });
    mkdirSync(storePackageDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(joinPath(globalPackageDir, "package.json"), "{}");
    writeFileSync(
      joinPath(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm"),
      createFakePnpmScript(root),
    );
    chmodSync(joinPath(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm"), 0o755);
    tempDir = temp;
    writeEnv("PATH", `${binDir}${pathDelimiter}${originalPath ?? ""}`);
    writeEnv("MSA_PACKAGE_DIR", storePackageDir);
    process.argv[1] = joinPath(globalPackageDir, "dist", "cli.js");
    setExecPath(joinPath(storePackageDir, "dist", "cli.js"));

    const command = getSelfUpdateCommand(packageName);

    expect(detectInstallMethod()).toBe("pnpm");
    expect(command).toEqual({
      command: "pnpm",
      args: ["install", "-g", "--ignore-scripts", "--config.minimumReleaseAge=0", packageName],
      display: `pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 ${packageName}`,
    });
  });

  test("self-updates renamed yarn global installs by removing the old package first", () => {
    createYarnGlobalInstall();

    const command = getSelfUpdateCommand(
      "@mariozechner/pi-coding-agent",
      undefined,
      "@new-scope/msa",
    );

    expect(detectInstallMethod()).toBe("yarn");
    expect(command).toEqual({
      command: "yarn",
      args: ["global", "add", "--ignore-scripts", "@new-scope/msa"],
      display:
        "yarn global remove @mariozechner/pi-coding-agent && yarn global add --ignore-scripts @new-scope/msa",
      steps: [
        {
          command: "yarn",
          args: ["global", "remove", "@mariozechner/pi-coding-agent"],
          display: "yarn global remove @mariozechner/pi-coding-agent",
        },
        {
          command: "yarn",
          args: ["global", "add", "--ignore-scripts", "@new-scope/msa"],
          display: "yarn global add --ignore-scripts @new-scope/msa",
        },
      ],
    });
  });

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

describe("detectInstallChange", () => {
  test("reports a removed install instead of reading a package.json further up", () => {
    tempDir = mkdtempSync(joinPath(tmpdir(), "msa-install-change-"));
    const installDir = joinPath(tempDir, "global", "hash");
    mkdirSync(installDir, { recursive: true });
    writeFileSync(joinPath(tempDir, "package.json"), JSON.stringify({ version: "0.0.1" }));
    rmSync(installDir, { recursive: true, force: true });
    expect(detectInstallChange(joinPath(installDir, "package.json"))).toEqual({
      kind: "removed" as const,
    });
  });
});
