import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import config from "../src/config.ts";
import processEnv from "../src/core/process-env.ts";

const { readEnv } = processEnv;
const { detectInstallMethod, getSelfUpdateCommand, getSelfUpdateUnavailableInstruction } = config;

const {
  changeMode,
  joinPath,
  makeDirectory,
  makeTempDir,
  pathDelimiter,
  removePath,
  runTest,
  writeTextFile,
} = testing;

const execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
const originalPath = readEnv("PATH");
const originalMsaPackageDir = readEnv("MSA_PACKAGE_DIR");
const originalArgv1 = process.argv[1];
let tempDir: string | undefined;

function setExecPath(value: string): void {
  Object.defineProperty(process, "execPath", {
    configurable: true,
    value,
  });
}

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      vi.unstubAllEnvs();
      if (execPathDescriptor !== undefined) {
        Object.defineProperty(process, "execPath", execPathDescriptor);
      }
      if (originalPath === undefined) vi.stubEnv("PATH", undefined);
      else vi.stubEnv("PATH", originalPath);
      if (originalMsaPackageDir === undefined) vi.stubEnv("MSA_PACKAGE_DIR", undefined);
      else vi.stubEnv("MSA_PACKAGE_DIR", originalMsaPackageDir);
      if (originalArgv1 === undefined) process.argv.splice(1, 1);
      else process.argv[1] = originalArgv1;
      if (tempDir !== undefined && tempDir.length > 0) {
        yield* removePath(tempDir);
        tempDir = undefined;
      }
    }),
  ),
);

const createNpmPrefixInstall = Effect.fn("createNpmPrefixInstall")(function* (
  template = "msa-prefix-",
) {
  const prefix = yield* makeTempDir(template);
  const root = joinPath(prefix, "lib", "node_modules");
  const scopeDir = joinPath(root, "@msa");
  const packageDir = joinPath(scopeDir, "coding-agent");
  yield* makeDirectory(packageDir);
  tempDir = prefix;
  vi.stubEnv("MSA_PACKAGE_DIR", packageDir);
  setExecPath(joinPath(packageDir, "dist", "cli.js"));
  return { packageDir, prefix };
});

const createBunGlobalInstall = Effect.fn("createBunGlobalInstall")(function* () {
  const temp = yield* makeTempDir("msa-bun-");
  const prefix = joinPath(temp, ".bun");
  const bunBin = joinPath(prefix, "bin");
  const root = joinPath(prefix, "install", "global", "node_modules");
  const scopeDir = joinPath(root, "@msa");
  const packageDir = joinPath(scopeDir, "coding-agent");
  yield* makeDirectory(packageDir);
  yield* makeDirectory(bunBin);
  const bunPath = joinPath(bunBin, process.platform === "win32" ? "bun.cmd" : "bun");
  yield* writeTextFile(bunPath, createFakeBunScript(bunBin));
  yield* changeMode(bunPath, 0o755);
  tempDir = temp;
  vi.stubEnv("PATH", `${bunBin}${pathDelimiter}${originalPath ?? ""}`);
  vi.stubEnv("MSA_PACKAGE_DIR", packageDir);
  setExecPath(joinPath(packageDir, "dist", "cli.js"));
  return { packageDir };
});

function createFakeBunScript(bunBin: string): string {
  if (process.platform === "win32") {
    return `@echo off\r\nif "%1"=="pm" if "%2"=="bin" if "%3"=="-g" echo ${bunBin}\r\n`;
  }
  const escapedBunBin = bunBin.replaceAll("'", "'\\''");
  return `#!/bin/sh\nif [ "$1" = "pm" ] && [ "$2" = "bin" ] && [ "$3" = "-g" ]; then\n\tprintf '%s\\n' '${escapedBunBin}'\n\texit 0\nfi\nexit 1\n`;
}

const selfUpdatesRenamedBunGlobalInstallsBy = () =>
  runTest(
    Effect.gen(function* () {
      yield* createBunGlobalInstall();
      const command = getSelfUpdateCommand(
        "@mariozechner/pi-coding-agent",
        undefined,
        "@new-scope/msa",
      );
      expect(detectInstallMethod()).toBe("bun");
      expect(command).toEqual({
        args: ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", "@new-scope/msa"],
        command: "bun",
        display:
          "bun uninstall -g @mariozechner/pi-coding-agent && bun install -g --ignore-scripts --minimum-release-age=0 @new-scope/msa",
        steps: [
          {
            args: ["uninstall", "-g", "@mariozechner/pi-coding-agent"],
            command: "bun",
            display: "bun uninstall -g @mariozechner/pi-coding-agent",
          },
          {
            args: [
              "install",
              "-g",
              "--ignore-scripts",
              "--minimum-release-age=0",
              "@new-scope/msa",
            ],
            command: "bun",
            display: "bun install -g --ignore-scripts --minimum-release-age=0 @new-scope/msa",
          },
        ],
      });
    }),
  );

const doesNotSelfUpdateWhenNpmInstall = () =>
  runTest(
    Effect.gen(function* () {
      const { packageDir } = yield* createNpmPrefixInstall();
      yield* changeMode(packageDir, 0o500);
      expect(getSelfUpdateCommand("@msa/coding-agent")).toBeUndefined();
      expect(getSelfUpdateUnavailableInstruction("@msa/coding-agent")).toContain(
        "the install path is not writable",
      );
    }),
  );

describe("detectInstallMethod 2", () => {
  test(
    "self-updates renamed bun global installs by removing the old package first",
    selfUpdatesRenamedBunGlobalInstallsBy,
  );
  test(
    "does not self-update when npm install path is not writable",
    doesNotSelfUpdateWhenNpmInstall,
  );
});
